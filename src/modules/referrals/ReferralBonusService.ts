// src/modules/referrals/ReferralBonusService.ts

import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../entities/ReferralBonus";

/**
 * ReferralBonusService
 *
 * Fase 2:
 * - Bônus UNIQUE no primeiro pagamento PAID de uma assinatura (idempotência por payerId + subscriptionId).
 *
 * Fase 3:
 * - Bônus RECURRENT por competência (YYYY-MM), gerado a cada pagamento PAID do mês.
 *
 * Observação:
 * - A idempotência final é garantida por `eventKey` (UNIQUE no banco).
 * - O repo exige `eventKey` para persistir.
 */
export class ReferralBonusService {
    // Ajuste as regras de valor conforme sua regra de negócio.
    private static readonly UNIQUE_AMOUNTS_BY_LEVEL: Record<number, number> = {
        1: 10,
        2: 5,
        3: 5,
    };

    // Ajuste as regras de valor conforme sua regra de negócio.
    private static readonly RECURRENT_AMOUNTS_BY_LEVEL: Record<number, number> = {
        1: 10,
        2: 5,
        3: 5,
    };

    constructor(
        private readonly userRepository: IUserRepository,
        private readonly referralRepository: IReferralRepository,
    ) {}

    /**
     * Fase 2:
     * Gera bônus UNIQUE (nível 1..3) no PRIMEIRO pagamento PAID de uma assinatura.
     *
     * Idempotência:
     * - Antes de gerar, verifica `hasUniqueBonusForPayerSubscription(payerId, subscriptionId)`.
     * - Cada bônus tem `eventKey` único.
     */
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

        // 1) Idempotência (por payer + subscription, independente do nível)
        const alreadyGenerated =
            await this.referralRepository.hasUniqueBonusForPayerSubscription(
                payerId,
                subscriptionId,
            );

        if (alreadyGenerated) return;

        // 2) Payer
        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        const level1Id = (payer as any).referrerId ?? null;
        if (!level1Id || level1Id <= 0) return;

        // LEVEL 1
        const level1User = await this.userRepository.findById(level1Id, false);
        if (this.isUserEligible(level1User)) {
            await this.safeSaveBonus(
                new ReferralBonus({
                    id: 0,
                    receiverId: level1Id,
                    payerId,
                    level: 1,
                    type: "UNIQUE",
                    amount:
                        ReferralBonusService.UNIQUE_AMOUNTS_BY_LEVEL[1] ?? 10,
                    paymentStatus: "PAID",
                    paymentId,
                    // 🔐 eventKey obrigatório
                    eventKey: this.buildUniqueEventKey({
                        payerId,
                        subscriptionId,
                        level: 1,
                        receiverId: level1Id,
                    }),
                }),
            );
        }

        // LEVEL 2
        const level2Id = (level1User as any)?.referrerId ?? null;
        if (level2Id && level2Id > 0) {
            const level2User = await this.userRepository.findById(level2Id, false);

            if (this.isUserEligible(level2User)) {
                await this.safeSaveBonus(
                    new ReferralBonus({
                        id: 0,
                        receiverId: level2Id,
                        payerId,
                        level: 2,
                        type: "UNIQUE",
                        amount:
                            ReferralBonusService.UNIQUE_AMOUNTS_BY_LEVEL[2] ?? 5,
                        paymentStatus: "PAID",
                        paymentId,
                        eventKey: this.buildUniqueEventKey({
                            payerId,
                            subscriptionId,
                            level: 2,
                            receiverId: level2Id,
                        }),
                    }),
                );
            }

            // LEVEL 3
            const level3Id = (level2User as any)?.referrerId ?? null;
            if (level3Id && level3Id > 0) {
                const level3User = await this.userRepository.findById(
                    level3Id,
                    false,
                );

                if (this.isUserEligible(level3User)) {
                    await this.safeSaveBonus(
                        new ReferralBonus({
                            id: 0,
                            receiverId: level3Id,
                            payerId,
                            level: 3,
                            type: "UNIQUE",
                            amount:
                                ReferralBonusService.UNIQUE_AMOUNTS_BY_LEVEL[3] ??
                                5,
                            paymentStatus: "PAID",
                            paymentId,
                            eventKey: this.buildUniqueEventKey({
                                payerId,
                                subscriptionId,
                                level: 3,
                                receiverId: level3Id,
                            }),
                        }),
                    );
                }
            }
        }
    }

    /**
     * Fase 3:
     * Gera bônus RECURRENT por competência (YYYY-MM) a cada pagamento PAID.
     *
     * Idempotência:
     * - `eventKey` inclui competência + payer + nível + receiver (UNIQUE no banco).
     * - Em retries do webhook/cron, o save vai falhar por UNIQUE; aqui tratamos isso como "ok".
     */
    public async generateRecurrentOnPaidPayment(params: {
        payerId: number;
        paymentId: number;
        paymentDate: Date;
        timeZoneOffsetMinutes?: number; // padrão -180 (America/Asuncion ~ GMT-3)
    }): Promise<void> {
        const payerId = Number(params.payerId);
        const paymentId = Number(params.paymentId);
        const paymentDate =
            params.paymentDate instanceof Date
                ? params.paymentDate
                : new Date(params.paymentDate as any);

        const timeZoneOffsetMinutes =
            params.timeZoneOffsetMinutes !== undefined &&
            params.timeZoneOffsetMinutes !== null &&
            !Number.isNaN(Number(params.timeZoneOffsetMinutes))
                ? Number(params.timeZoneOffsetMinutes)
                : -180;

        if (!payerId || Number.isNaN(payerId)) return;
        if (!paymentId || Number.isNaN(paymentId)) return;
        if (!(paymentDate instanceof Date) || Number.isNaN(paymentDate.getTime()))
            return;

        const competenceYearMonth = this.toCompetenceYearMonth(
            paymentDate,
            timeZoneOffsetMinutes,
        );

        // Payer
        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        const level1Id = (payer as any).referrerId ?? null;
        if (!level1Id || level1Id <= 0) return;

        // LEVEL 1
        const level1User = await this.userRepository.findById(level1Id, false);
        if (this.isUserEligible(level1User)) {
            await this.safeSaveBonus(
                new ReferralBonus({
                    id: 0,
                    receiverId: level1Id,
                    payerId,
                    level: 1,
                    type: "RECURRENT",
                    amount:
                        ReferralBonusService.RECURRENT_AMOUNTS_BY_LEVEL[1] ?? 10,
                    paymentStatus: "PAID",
                    competenceYearMonth,
                    paymentId,
                    eventKey: this.buildRecurrentEventKey({
                        competenceYearMonth,
                        payerId,
                        level: 1,
                        receiverId: level1Id,
                    }),
                }),
            );
        }

        // LEVEL 2
        const level2Id = (level1User as any)?.referrerId ?? null;
        if (level2Id && level2Id > 0) {
            const level2User = await this.userRepository.findById(level2Id, false);

            if (this.isUserEligible(level2User)) {
                await this.safeSaveBonus(
                    new ReferralBonus({
                        id: 0,
                        receiverId: level2Id,
                        payerId,
                        level: 2,
                        type: "RECURRENT",
                        amount:
                            ReferralBonusService.RECURRENT_AMOUNTS_BY_LEVEL[2] ?? 5,
                        paymentStatus: "PAID",
                        competenceYearMonth,
                        paymentId,
                        eventKey: this.buildRecurrentEventKey({
                            competenceYearMonth,
                            payerId,
                            level: 2,
                            receiverId: level2Id,
                        }),
                    }),
                );
            }

            // LEVEL 3
            const level3Id = (level2User as any)?.referrerId ?? null;
            if (level3Id && level3Id > 0) {
                const level3User = await this.userRepository.findById(
                    level3Id,
                    false,
                );

                if (this.isUserEligible(level3User)) {
                    await this.safeSaveBonus(
                        new ReferralBonus({
                            id: 0,
                            receiverId: level3Id,
                            payerId,
                            level: 3,
                            type: "RECURRENT",
                            amount:
                                ReferralBonusService.RECURRENT_AMOUNTS_BY_LEVEL[3] ??
                                5,
                            paymentStatus: "PAID",
                            competenceYearMonth,
                            paymentId,
                            eventKey: this.buildRecurrentEventKey({
                                competenceYearMonth,
                                payerId,
                                level: 3,
                                receiverId: level3Id,
                            }),
                        }),
                    );
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Helpers internos
    // ---------------------------------------------------------------------

    private isUserEligible(user: any): boolean {
        if (!user) return false;

        // Se não existir status, assume elegível (compat com legado)
        const status = (user as any)?.status;
        if (!status) return true;

        return status === "ACTIVE";
    }

    /**
     * Converte Date -> "YYYY-MM" respeitando offset (minutos).
     * Ex: offset -180 => GMT-3.
     */
    private toCompetenceYearMonth(date: Date, offsetMinutes: number): string {
        const d = new Date(date.getTime());
        d.setMinutes(d.getMinutes() + offsetMinutes);

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
    }

    private buildUniqueEventKey(params: {
        payerId: number;
        subscriptionId: number;
        level: number;
        receiverId: number;
    }): string {
        // Mantém um padrão estável e consultável por prefixo.
        // O repo pode buscar prefixo por payer+subscription.
        return `UNIQUE:subscription:${params.subscriptionId}:payer:${params.payerId}:level:${params.level}:receiver:${params.receiverId}`;
    }

    private buildRecurrentEventKey(params: {
        competenceYearMonth: string;
        payerId: number;
        level: number;
        receiverId: number;
    }): string {
        return `RECURRENT:${params.competenceYearMonth}:payer:${params.payerId}:level:${params.level}:receiver:${params.receiverId}`;
    }

    /**
     * Salva de forma “retry-safe”:
     * - Se ocorrer erro de UNIQUE (eventKey duplicado), ignora.
     */
    private async safeSaveBonus(referralBonus: ReferralBonus): Promise<void> {
        try {
            await this.referralRepository.save(referralBonus);
        } catch (err: any) {
            const msg = String(err?.message ?? "");
            const code = String(err?.code ?? "");

            // Prisma: P2002 = Unique constraint failed
            if (code === "P2002") return;

            // fallback genérico (quando a camada acima encapsula o erro)
            if (
                msg.toLowerCase().includes("unique constraint") ||
                msg.toLowerCase().includes("duplicate") ||
                msg.toLowerCase().includes("p2002")
            ) {
                return;
            }

            throw err;
        }
    }
}
