// src/modules/referrals/ReferralBonusService.ts

import { Prisma, TransactionSource, TransactionType, WalletType } from "@prisma/client";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../entities/ReferralBonus";
import prisma from "../../config/dbConfig";

/**
 * ReferralBonusService
 *
 * ✅ MODELO (Opção A):
 * - Bônus por GRUPO FECHADO (até 9 pessoas) e POSIÇÃO.
 * - O pagador (payer) PRECISA estar em ReferralGroupMember com position definida.
 * - Recebedores = posições 1..(payer.position - 1) dentro do MESMO grupo.
 * - Valores vêm de ReferralPositionBonusConfig:
 *    - position = posição do RECEBEDOR
 *    - type = UNIQUE | RECURRENT
 *    - isActive = true
 *
 * ✅ UNIQUE:
 * - Gera no primeiro pagamento PAID da assinatura (gatilho vem do PaymentService).
 * - Credita cashback IMEDIATO (sem atraso).
 * - NÃO bloqueia por cashbackSuspended do grupo.
 *
 * ✅ RECURRENT (Opção A — atraso de 8 dias, sem schema novo):
 * - No pagamento PAID: cria ReferralBonus com paymentStatus=PENDING (idempotente por eventKey)
 * - NÃO credita cashback no PAID
 * - Job diário: libera os PENDING (>= 8 dias), criando CashbackTransaction + wallet increment,
 *   e marca ReferralBonus.paymentStatus = PAID (idempotente por eventKey)
 * - BLOQUEIA a criação do PENDING se:
 *    - grupo.cashbackSuspended === true
 *    - payer tiver inadimplência (PENDING com dueAt < now)
 *
 * ✅ IDÊMPOTÊNCIA:
 * - ReferralBonus: único por eventKey
 * - CashbackTransaction: único por eventKey
 * - Se CashbackTransaction já existir, job apenas marca o ReferralBonus como PAID
 *
 * ✅ PRISMA JSON:
 * - NUNCA enviar meta=null
 */
export class ReferralBonusService {
    constructor(
        private readonly userRepository: IUserRepository,
        // Mantido por compatibilidade com a injeção atual do projeto.
        // Não é mais necessário para persistência, pois este service usa Prisma para atomicidade.
        private readonly referralRepository: IReferralRepository,
    ) {}

    // ---------------------------------------------------------------------
    // 🔒 BLOQUEIO POR INADIMPLÊNCIA (aplica ao RECURRENT)
    // ---------------------------------------------------------------------

    /**
     * Retorna TRUE se o usuário tiver algum pagamento:
     * - status = PENDING
     * - dueAt < now()
     */
    private async payerIsInDefault(payerId: number): Promise<boolean> {
        const overdue = await prisma.payment.findFirst({
            where: {
                userId: payerId,
                status: "PENDING",
                dueAt: { lt: new Date() },
            },
            select: { id: true },
        });

        return !!overdue;
    }

    // ---------------------------------------------------------------------
    // CONTEXTO DE GRUPO / POSIÇÃO
    // ---------------------------------------------------------------------

    private async resolvePayerGroupContext(payerId: number): Promise<{
        groupId: number;
        payerPosition: number;
        groupCashbackSuspended: boolean;
        groupIsClosed: boolean;
        groupMaxMembers: number;
    } | null> {
        const membership = await prisma.referralGroupMember.findFirst({
            where: { userId: payerId },
            orderBy: { joinedAt: "desc" },
            select: {
                groupId: true,
                position: true,
                group: {
                    select: {
                        cashbackSuspended: true,
                        isClosed: true,
                        maxMembers: true,
                    },
                },
            },
        });

        if (!membership) return null;

        const groupId = Number(membership.groupId);
        const payerPosition = Number(membership.position);

        if (!groupId || Number.isNaN(groupId)) return null;
        if (!payerPosition || Number.isNaN(payerPosition)) return null;

        return {
            groupId,
            payerPosition,
            groupCashbackSuspended: Boolean(membership.group?.cashbackSuspended),
            groupIsClosed: Boolean(membership.group?.isClosed),
            groupMaxMembers: Number(membership.group?.maxMembers ?? 9),
        };
    }

    private async listEligibleReceiversInGroup(params: {
        groupId: number;
        payerPosition: number;
    }): Promise<Array<{ receiverId: number; receiverPosition: number }>> {
        const groupId = Number(params.groupId);
        const payerPosition = Number(params.payerPosition);

        if (!groupId || Number.isNaN(groupId)) return [];
        if (!payerPosition || Number.isNaN(payerPosition)) return [];

        if (payerPosition <= 1) return [];

        const members = await prisma.referralGroupMember.findMany({
            where: {
                groupId,
                position: { lt: payerPosition },
            },
            orderBy: { position: "asc" },
            select: {
                userId: true,
                position: true,
                user: {
                    select: {
                        status: true,
                    },
                },
            },
        });

        const receivers: Array<{ receiverId: number; receiverPosition: number }> = [];

        for (const m of members) {
            const receiverId = Number(m.userId);
            const receiverPosition = Number(m.position);

            if (!receiverId || Number.isNaN(receiverId)) continue;
            if (!receiverPosition || Number.isNaN(receiverPosition)) continue;

            // status pode ser null/undefined em dados antigos -> considera elegível
            const status = (m.user as any)?.status;
            if (status && status !== "ACTIVE") {
                continue;
            }

            receivers.push({ receiverId, receiverPosition });
        }

        return receivers;
    }

    private async loadActiveBonusConfigByPosition(params: {
        type: "UNIQUE" | "RECURRENT";
        positions: number[];
    }): Promise<Map<number, number>> {
        const positions = Array.from(
            new Set((params.positions ?? []).map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0)),
        );

        const map = new Map<number, number>();

        if (positions.length === 0) {
            return map;
        }

        const rows = await prisma.referralPositionBonusConfig.findMany({
            where: {
                type: params.type,
                isActive: true,
                position: { in: positions },
            },
            select: {
                position: true,
                amount: true,
            },
        });

        for (const r of rows) {
            const pos = Number(r.position);
            const amount = Number(r.amount ?? 0);

            if (!pos || Number.isNaN(pos)) continue;
            if (!Number.isFinite(amount) || amount <= 0) continue;

            map.set(pos, Number(amount.toFixed(2)));
        }

        return map;
    }

    // ---------------------------------------------------------------------
    // UNIQUE — primeiro pagamento PAID da assinatura (crédito imediato)
    // ---------------------------------------------------------------------

    public async generateUniqueOnFirstPaidSubscription(params: {
        payerId: number;
        subscriptionId: number;
        paymentId?: number;
    }): Promise<void> {
        const payerId = Number(params.payerId);
        const subscriptionId = Number(params.subscriptionId);
        const paymentId =
            params.paymentId !== undefined && params.paymentId !== null ? Number(params.paymentId) : undefined;

        if (!payerId || Number.isNaN(payerId)) return;
        if (!subscriptionId || Number.isNaN(subscriptionId)) return;

        // Confirma que o payer existe (segurança)
        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        // ✅ EXIGE grupo/posição (implicitamente) — se não tiver, aborta silencioso
        const ctx = await this.resolvePayerGroupContext(payerId);
        if (!ctx) {
            console.warn(
                `[ReferralBonusService][UNIQUE] payerId=${payerId} sem ReferralGroupMember. Abortando geração de bônus UNIQUE.`,
            );
            return;
        }

        const receivers = await this.listEligibleReceiversInGroup({
            groupId: ctx.groupId,
            payerPosition: ctx.payerPosition,
        });

        if (receivers.length === 0) return;

        const receiverPositions = receivers.map((r) => r.receiverPosition);

        const configMap = await this.loadActiveBonusConfigByPosition({
            type: "UNIQUE",
            positions: receiverPositions,
        });

        if (configMap.size === 0) return;

        for (const r of receivers) {
            const amount = Number(configMap.get(r.receiverPosition) ?? 0);
            if (!Number.isFinite(amount) || amount <= 0) continue;

            const eventKey = this.buildGroupUniqueEventKey({
                groupId: ctx.groupId,
                payerId,
                payerPosition: ctx.payerPosition,
                receiverId: r.receiverId,
                receiverPosition: r.receiverPosition,
                subscriptionId,
            });

            await this.awardBonusAndCashbackAtomicImmediate({
                type: "UNIQUE",
                eventKey,
                amount,
                receiverId: r.receiverId,
                payerId,
                levelOrPosition: r.receiverPosition, // compat: level = posição
                paymentId,
                competenceYearMonth: undefined,
                relatedId: `subscription:${subscriptionId}`,
                referralGroupId: ctx.groupId,
                referralPosition: r.receiverPosition,
                meta: {
                    type: "UNIQUE",
                    groupId: ctx.groupId,
                    payerId,
                    payerPosition: ctx.payerPosition,
                    receiverId: r.receiverId,
                    receiverPosition: r.receiverPosition,
                    subscriptionId,
                    paymentId: paymentId ?? null,
                },
            });
        }
    }

    // ---------------------------------------------------------------------
    // RECURRENT — no pagamento PAID cria PENDING (atraso de 8 dias)
    // ---------------------------------------------------------------------

    public async generateRecurrentOnPaidPayment(params: {
        payerId: number;
        paymentId: number;
        paymentDate: Date;
        timeZoneOffsetMinutes?: number;
    }): Promise<void> {
        const payerId = Number(params.payerId);
        const paymentId = Number(params.paymentId);
        const paymentDate =
            params.paymentDate instanceof Date ? params.paymentDate : new Date(params.paymentDate as any);

        const offset =
            typeof params.timeZoneOffsetMinutes === "number" ? params.timeZoneOffsetMinutes : -180;

        if (!payerId || Number.isNaN(payerId)) return;
        if (!paymentId || Number.isNaN(paymentId)) return;
        if (Number.isNaN(paymentDate.getTime())) return;

        // Confirma que o payer existe (segurança)
        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        // 🔒 BLOQUEIO POR INADIMPLÊNCIA (mantido para RECURRENT)
        if (await this.payerIsInDefault(payerId)) {
            return;
        }

        // ✅ EXIGE grupo/posição (implicitamente) — se não tiver, aborta silencioso
        const ctx = await this.resolvePayerGroupContext(payerId);
        if (!ctx) {
            console.warn(
                `[ReferralBonusService][RECURRENT] payerId=${payerId} sem ReferralGroupMember. Abortando geração de bônus RECURRENT.`,
            );
            return;
        }

        // 🔒 BLOQUEIO POR SUSPENSÃO DE GRUPO (somente RECURRENT)
        if (ctx.groupCashbackSuspended === true) {
            return;
        }

        const competenceYearMonth = this.toCompetenceYearMonth(paymentDate, offset);

        const receivers = await this.listEligibleReceiversInGroup({
            groupId: ctx.groupId,
            payerPosition: ctx.payerPosition,
        });

        if (receivers.length === 0) return;

        const receiverPositions = receivers.map((r) => r.receiverPosition);

        const configMap = await this.loadActiveBonusConfigByPosition({
            type: "RECURRENT",
            positions: receiverPositions,
        });

        if (configMap.size === 0) return;

        for (const r of receivers) {
            const amount = Number(configMap.get(r.receiverPosition) ?? 0);
            if (!Number.isFinite(amount) || amount <= 0) continue;

            const eventKey = this.buildGroupRecurrentEventKey({
                groupId: ctx.groupId,
                payerId,
                payerPosition: ctx.payerPosition,
                receiverId: r.receiverId,
                receiverPosition: r.receiverPosition,
                paymentId,
                competenceYearMonth,
            });

            // ✅ OPÇÃO A: cria SOMENTE o ReferralBonus em PENDING (sem wallet/cashback aqui)
            await this.createPendingRecurrentBonusAtomic({
                eventKey,
                amount,
                receiverId: r.receiverId,
                payerId,
                receiverPosition: r.receiverPosition,
                paymentId,
                competenceYearMonth,
            });
        }
    }

    // ---------------------------------------------------------------------
    // ATOMIC IMMEDIATE AWARD (UNIQUE)
    // ---------------------------------------------------------------------

    private async awardBonusAndCashbackAtomicImmediate(params: {
        type: "UNIQUE";
        eventKey: string;
        amount: number;

        receiverId: number;
        payerId: number;

        levelOrPosition: number;

        paymentId?: number;
        competenceYearMonth?: string;

        relatedId?: string | null;

        referralGroupId?: number | null;
        referralPosition?: number | null;

        meta: Record<string, any>;
    }): Promise<void> {
        const eventKey = String(params.eventKey ?? "").trim();
        if (!eventKey) return;

        const receiverId = Number(params.receiverId);
        const payerId = Number(params.payerId);
        const amount = Number(params.amount);

        if (!receiverId || Number.isNaN(receiverId)) return;
        if (!payerId || Number.isNaN(payerId)) return;
        if (!Number.isFinite(amount) || amount <= 0) return;

        const levelOrPosition = Number(params.levelOrPosition);
        if (!levelOrPosition || Number.isNaN(levelOrPosition)) return;

        const paymentId =
            params.paymentId !== undefined && params.paymentId !== null ? Number(params.paymentId) : undefined;

        const competenceYearMonth =
            params.competenceYearMonth !== undefined && params.competenceYearMonth !== null
                ? String(params.competenceYearMonth)
                : undefined;

        const referralGroupId =
            params.referralGroupId !== undefined && params.referralGroupId !== null
                ? Number(params.referralGroupId)
                : null;

        const referralPosition =
            params.referralPosition !== undefined && params.referralPosition !== null
                ? Number(params.referralPosition)
                : null;

        const relatedId =
            params.relatedId !== undefined && params.relatedId !== null ? String(params.relatedId) : null;

        const metaInput: Prisma.InputJsonValue = (params.meta ?? {}) as Prisma.InputJsonValue;

        try {
            await prisma.$transaction(async (tx) => {
                // 1) ReferralBonus (idempotente por eventKey)
                const existingBonus = await tx.referralBonus.findUnique({
                    where: { eventKey },
                    select: { id: true },
                });

                if (!existingBonus) {
                    try {
                        const bonus = new ReferralBonus({
                            id: 0,
                            receiverId,
                            payerId,
                            level: levelOrPosition,
                            type: params.type,
                            amount: Number(amount.toFixed(2)),
                            paymentStatus: "PAID",
                            eventKey,
                            competenceYearMonth: competenceYearMonth,
                            paymentId: paymentId,
                        });

                        await tx.referralBonus.create({
                            data: {
                                receiverId: (bonus as any).receiverId,
                                payerId: (bonus as any).payerId,
                                level: (bonus as any).level,
                                type: (bonus as any).type,
                                amount: Number((bonus as any).amount ?? 0),
                                paymentStatus: (bonus as any).paymentStatus ?? "PAID",
                                eventKey: (bonus as any).eventKey,
                                competenceYearMonth: (bonus as any).competenceYearMonth ?? null,
                                paymentId: (bonus as any).paymentId ?? null,
                            },
                        });
                    } catch (err: any) {
                        const code = String(err?.code ?? "");
                        if (code !== "P2002") throw err;
                    }
                }

                // 2) CashbackTransaction (idempotente por eventKey) + Wallet increment
                const existingCashbackTx = await tx.cashbackTransaction.findUnique({
                    where: { eventKey },
                    select: { id: true },
                });

                if (!existingCashbackTx) {
                    const wallet = await tx.cashbackWallet.upsert({
                        where: {
                            userId_type: {
                                userId: receiverId,
                                type: WalletType.INTERNAL,
                            },
                        },
                        update: {},
                        create: {
                            userId: receiverId,
                            type: WalletType.INTERNAL,
                            balance: 0,
                        },
                        select: { id: true },
                    });

                    try {
                        await tx.cashbackTransaction.create({
                            data: {
                                userId: receiverId,
                                type: TransactionType.EARNED,
                                source: TransactionSource.INDICATION,
                                amount: Number(amount.toFixed(2)),
                                relatedId: relatedId,
                                eventKey,
                                meta: metaInput,
                                expiresAt: null,
                                referralGroupId,
                                referralPosition,
                            },
                        });

                        await tx.cashbackWallet.update({
                            where: { id: wallet.id },
                            data: {
                                balance: { increment: Number(amount.toFixed(2)) },
                            },
                        });
                    } catch (err: any) {
                        const code = String(err?.code ?? "");
                        if (code === "P2002") return;
                        throw err;
                    }
                }
            });
        } catch (err: any) {
            const code = String(err?.code ?? "");
            const msg = String(err?.message ?? "");

            if (code === "P2002") return;

            if (
                msg.toLowerCase().includes("unique") ||
                msg.toLowerCase().includes("duplicate") ||
                msg.toLowerCase().includes("p2002")
            ) {
                return;
            }

            throw err;
        }
    }

    // ---------------------------------------------------------------------
    // 🕗 OPÇÃO A — RECURRENT com atraso de 8 dias (sem schema)
    // ---------------------------------------------------------------------

    private static readonly RECURRENT_RELEASE_DELAY_DAYS = 8;

    private computeReleaseCutoff(now: Date): Date {
        const d = new Date(now.getTime());
        d.setDate(d.getDate() - ReferralBonusService.RECURRENT_RELEASE_DELAY_DAYS);
        return d;
    }

    private parseRecurrentEventKey(eventKey: string): {
        groupId?: number;
        paymentId?: number;
        payerId?: number;
        payerPos?: number;
        receiverId?: number;
        receiverPos?: number;
        competenceYearMonth?: string;
    } {
        const parts = String(eventKey ?? "")
            .split(":")
            .map((p) => p.trim())
            .filter(Boolean);

        const readNum = (prefix: string): number | undefined => {
            const idx = parts.findIndex((p) => p === prefix);
            if (idx < 0) return undefined;
            const raw = parts[idx + 1];
            const n = Number(raw);
            return Number.isFinite(n) ? n : undefined;
        };

        const readStr = (prefix: string): string | undefined => {
            const idx = parts.findIndex((p) => p === prefix);
            if (idx < 0) return undefined;
            const raw = parts[idx + 1];
            return raw ? String(raw) : undefined;
        };

        return {
            groupId: readNum("group"),
            paymentId: readNum("payment"),
            payerId: readNum("payer"),
            payerPos: readNum("payerPos"),
            receiverId: readNum("receiver"),
            receiverPos: readNum("receiverPos"),
            competenceYearMonth: readStr("competence"),
        };
    }

    private async createPendingRecurrentBonusAtomic(params: {
        eventKey: string;
        amount: number;
        receiverId: number;
        payerId: number;
        receiverPosition: number;
        paymentId: number;
        competenceYearMonth: string;
    }): Promise<void> {
        const eventKey = String(params.eventKey ?? "").trim();
        if (!eventKey) return;

        const amount = Number(params.amount);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const receiverId = Number(params.receiverId);
        const payerId = Number(params.payerId);
        const paymentId = Number(params.paymentId);
        const receiverPosition = Number(params.receiverPosition);
        const competenceYearMonth = String(params.competenceYearMonth ?? "").trim();

        if (!receiverId || Number.isNaN(receiverId)) return;
        if (!payerId || Number.isNaN(payerId)) return;
        if (!paymentId || Number.isNaN(paymentId)) return;
        if (!receiverPosition || Number.isNaN(receiverPosition)) return;
        if (!competenceYearMonth) return;

        await prisma.$transaction(async (tx) => {
            const existing = await tx.referralBonus.findUnique({
                where: { eventKey },
                select: { id: true },
            });

            if (existing) return;

            try {
                await tx.referralBonus.create({
                    data: {
                        receiverId,
                        payerId,
                        level: receiverPosition,
                        type: "RECURRENT",
                        amount: Number(amount.toFixed(2)),
                        paymentStatus: "PENDING",
                        eventKey,
                        competenceYearMonth,
                        paymentId,
                    },
                });
            } catch (err: any) {
                if (String(err?.code ?? "") === "P2002") return;
                throw err;
            }
        });
    }

    private async releaseOnePendingRecurrentBonusAtomic(bonusId: number): Promise<void> {
        const id = Number(bonusId);
        if (!id || Number.isNaN(id)) return;

        await prisma.$transaction(async (tx) => {
            const bonus = await tx.referralBonus.findUnique({
                where: { id },
                select: {
                    id: true,
                    type: true,
                    paymentStatus: true,
                    eventKey: true,
                    amount: true,
                    receiverId: true,
                    payerId: true,
                    competenceYearMonth: true,
                    paymentId: true,
                },
            });

            if (!bonus) return;
            if (bonus.type !== "RECURRENT") return;

            if (bonus.paymentStatus === "PAID") return;

            const eventKey = String(bonus.eventKey ?? "").trim();
            if (!eventKey) return;

            const existingCashbackTx = await tx.cashbackTransaction.findUnique({
                where: { eventKey },
                select: { id: true },
            });

            if (!existingCashbackTx) {
                const parsed = this.parseRecurrentEventKey(eventKey);

                const amount = Number(bonus.amount ?? 0);
                if (!Number.isFinite(amount) || amount <= 0) return;

                const wallet = await tx.cashbackWallet.upsert({
                    where: {
                        userId_type: {
                            userId: bonus.receiverId,
                            type: WalletType.INTERNAL,
                        },
                    },
                    update: {},
                    create: {
                        userId: bonus.receiverId,
                        type: WalletType.INTERNAL,
                        balance: 0,
                    },
                    select: { id: true },
                });

                try {
                    await tx.cashbackTransaction.create({
                        data: {
                            userId: bonus.receiverId,
                            type: TransactionType.EARNED,
                            source: TransactionSource.INDICATION,
                            amount: Number(amount.toFixed(2)),
                            relatedId: bonus.paymentId ? `payment:${bonus.paymentId}` : null,
                            eventKey,
                            meta: {
                                type: "RECURRENT_RELEASED",
                                competenceYearMonth: bonus.competenceYearMonth ?? null,
                                groupId: parsed.groupId ?? null,
                                payerId: parsed.payerId ?? bonus.payerId,
                                payerPosition: parsed.payerPos ?? null,
                                receiverId: parsed.receiverId ?? bonus.receiverId,
                                receiverPosition: parsed.receiverPos ?? null,
                                paymentId: parsed.paymentId ?? bonus.paymentId ?? null,
                                bonusId: bonus.id,
                            } as Prisma.InputJsonValue,
                            expiresAt: null,
                            referralGroupId: parsed.groupId ?? null,
                            referralPosition: parsed.receiverPos ?? null,
                        },
                    });

                    await tx.cashbackWallet.update({
                        where: { id: wallet.id },
                        data: {
                            balance: { increment: Number(amount.toFixed(2)) },
                        },
                    });
                } catch (err: any) {
                    if (String(err?.code ?? "") !== "P2002") throw err;
                }
            }

            await tx.referralBonus.update({
                where: { id: bonus.id },
                data: { paymentStatus: "PAID" },
            });
        });
    }

    /**
     * ✅ método esperado pelo job:
     * - assinatura: processDueRecurrentBonuses(now: Date)
     * - retorno: { processed: number }
     */
    public async processDueRecurrentBonuses(now: Date): Promise<{ processed: number }> {
        const safeNow = now instanceof Date ? now : new Date(now as any);
        if (Number.isNaN(safeNow.getTime())) return { processed: 0 };

        const cutoff = this.computeReleaseCutoff(safeNow);

        // assume createdAt existe; se não existir, me diz o nome do campo e eu ajusto
        const pending = await prisma.referralBonus.findMany({
            where: {
                type: "RECURRENT",
                paymentStatus: "PENDING",
                createdAt: { lte: cutoff },
            } as any,
            orderBy: { createdAt: "asc" } as any,
            take: 500,
            select: { id: true },
        });

        let processed = 0;

        for (const b of pending) {
            try {
                await this.releaseOnePendingRecurrentBonusAtomic(b.id);
                processed++;
            } catch (err) {
                console.error("[ReferralBonusService][processDueRecurrentBonuses] erro bonusId=", b.id, err);
            }
        }

        return { processed };
    }

    // ---------------------------------------------------------------------
    // EVENT KEYS — GRUPO / POSIÇÃO
    // ---------------------------------------------------------------------

    private buildGroupUniqueEventKey(params: {
        groupId: number;
        payerId: number;
        payerPosition: number;
        receiverId: number;
        receiverPosition: number;
        subscriptionId: number;
    }): string {
        return [
            "BONUS",
            "UNIQUE",
            `group:${params.groupId}`,
            `subscription:${params.subscriptionId}`,
            `payer:${params.payerId}`,
            `payerPos:${params.payerPosition}`,
            `receiver:${params.receiverId}`,
            `receiverPos:${params.receiverPosition}`,
        ].join(":");
    }

    private buildGroupRecurrentEventKey(params: {
        groupId: number;
        payerId: number;
        payerPosition: number;
        receiverId: number;
        receiverPosition: number;
        paymentId: number;
        competenceYearMonth: string;
    }): string {
        return [
            "BONUS",
            "RECURRENT",
            `group:${params.groupId}`,
            `competence:${params.competenceYearMonth}`,
            `payment:${params.paymentId}`,
            `payer:${params.payerId}`,
            `payerPos:${params.payerPosition}`,
            `receiver:${params.receiverId}`,
            `receiverPos:${params.receiverPosition}`,
        ].join(":");
    }

    // ---------------------------------------------------------------------
    // HELPERS
    // ---------------------------------------------------------------------

    private toCompetenceYearMonth(date: Date, offsetMinutes: number): string {
        const d = new Date(date.getTime());
        d.setMinutes(d.getMinutes() + offsetMinutes);

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
    }
}
