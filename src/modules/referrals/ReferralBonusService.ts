// src/modules/referrals/ReferralBonusService.ts

import { Prisma, TransactionSource, TransactionType, WalletType } from "@prisma/client";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../entities/ReferralBonus";
import prisma from "../../config/dbConfig";

/**
 * ReferralBonusService
 *
 * ✅ MODELO ATUAL (Opção B):
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
 * - NÃO bloqueia por cashbackSuspended do grupo.
 *
 * ✅ RECURRENT:
 * - Gera por pagamento PAID, idempotente por paymentId.
 * - BLOQUEIA se:
 *    - grupo.cashbackSuspended === true
 *    - payer estiver inadimplente (PENDING com dueAt < now)
 *
 * ✅ AUDITORIA / CASHBACK:
 * - Cria ReferralBonus (eventKey único)
 * - Credita CashbackWallet INTERNAL (increment)
 * - Cria CashbackTransaction EARNED (eventKey único)
 * - NUNCA envia meta=null (evita TS2322 / Prisma Json input)
 */
export class ReferralBonusService {
    constructor(
        private readonly userRepository: IUserRepository,
        // Mantido por compatibilidade com a injeção atual do projeto.
        // Não é mais necessário para persistência, pois este service passou a usar Prisma
        // para garantir atomicidade (bonus + wallet + transaction) em uma única transação.
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
    // UNIQUE — primeiro pagamento PAID da assinatura
    // ---------------------------------------------------------------------

    public async generateUniqueOnFirstPaidSubscription(params: {
        payerId: number;
        subscriptionId: number;
        paymentId?: number;
    }): Promise<void> {
        const payerId = Number(params.payerId);
        const subscriptionId = Number(params.subscriptionId);
        const paymentId =
            params.paymentId !== undefined && params.paymentId !== null
                ? Number(params.paymentId)
                : undefined;

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

            await this.awardBonusAndCashbackAtomic({
                type: "UNIQUE",
                eventKey,
                amount,
                receiverId: r.receiverId,
                payerId,
                levelOrPosition: r.receiverPosition, // usamos "level" como posição do recebedor para compat
                paymentId: paymentId,
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
    // RECURRENT — por pagamento PAID (idempotente por paymentId)
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
            params.paymentDate instanceof Date
                ? params.paymentDate
                : new Date(params.paymentDate as any);

        const offset =
            typeof params.timeZoneOffsetMinutes === "number"
                ? params.timeZoneOffsetMinutes
                : -180;

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

            await this.awardBonusAndCashbackAtomic({
                type: "RECURRENT",
                eventKey,
                amount,
                receiverId: r.receiverId,
                payerId,
                levelOrPosition: r.receiverPosition, // usamos "level" como posição do recebedor para compat
                paymentId: paymentId,
                competenceYearMonth,
                relatedId: `payment:${paymentId}`,
                referralGroupId: ctx.groupId,
                referralPosition: r.receiverPosition,
                meta: {
                    type: "RECURRENT",
                    groupId: ctx.groupId,
                    payerId,
                    payerPosition: ctx.payerPosition,
                    receiverId: r.receiverId,
                    receiverPosition: r.receiverPosition,
                    paymentId,
                    competenceYearMonth,
                },
            });
        }
    }

    // ---------------------------------------------------------------------
    // ATOMIC AWARD (ReferralBonus + CashbackTransaction + Wallet increment)
    // ---------------------------------------------------------------------

    private async awardBonusAndCashbackAtomic(params: {
        type: "UNIQUE" | "RECURRENT";
        eventKey: string;
        amount: number;

        receiverId: number;
        payerId: number;

        // compat: o schema atual de ReferralBonus ainda tem "level"
        // aqui usaremos como "receiverPosition" (1..9)
        levelOrPosition: number;

        paymentId?: number;
        competenceYearMonth?: string;

        // CashbackTransaction.relatedId é String?
        relatedId?: string | null;

        // Auditoria do grupo no CashbackTransaction
        referralGroupId?: number | null;
        referralPosition?: number | null;

        // Json do prisma: nunca enviar null
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
            params.paymentId !== undefined && params.paymentId !== null
                ? Number(params.paymentId)
                : undefined;

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
            params.relatedId !== undefined && params.relatedId !== null
                ? String(params.relatedId)
                : null;

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
                        if (code !== "P2002") {
                            throw err;
                        }
                        // P2002: já existe (idempotência)
                    }
                }

                // 2) CashbackTransaction (idempotente por eventKey) + Wallet increment
                const existingCashbackTx = await tx.cashbackTransaction.findUnique({
                    where: { eventKey },
                    select: { id: true },
                });

                if (!existingCashbackTx) {
                    // garante wallet
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

                    // cria transação (se falhar por P2002, não incrementa)
                    try {
                        await tx.cashbackTransaction.create({
                            data: {
                                userId: receiverId,
                                type: TransactionType.EARNED,
                                source: TransactionSource.INDICATION,
                                amount: Number(amount.toFixed(2)),
                                relatedId: relatedId,
                                eventKey: eventKey,
                                meta: metaInput,
                                expiresAt: null,
                                referralGroupId: referralGroupId,
                                referralPosition: referralPosition,
                            },
                        });

                        await tx.cashbackWallet.update({
                            where: { id: wallet.id },
                            data: {
                                balance: {
                                    increment: Number(amount.toFixed(2)),
                                },
                            },
                        });
                    } catch (err: any) {
                        const code = String(err?.code ?? "");
                        if (code === "P2002") {
                            // idempotência: já criaram a tx, então NÃO incrementa
                            return;
                        }
                        throw err;
                    }
                }
            });
        } catch (err: any) {
            // Duplicidade: não quebra o fluxo do webhook
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
