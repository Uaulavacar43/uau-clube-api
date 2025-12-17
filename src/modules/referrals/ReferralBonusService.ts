// src/modules/referrals/ReferralBonusService.ts

import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../entities/ReferralBonus";
import prisma from "../../config/dbConfig";

/**
 * ReferralBonusService
 *
 * Fase 2:
 * - Bônus UNIQUE no primeiro pagamento PAID de uma assinatura.
 *
 * Fase 3:
 * - Bônus RECURRENT por competência (YYYY-MM).
 *
 * Fase 4:
 * - Bloqueio automático de bônus se o payer estiver inadimplente.
 */
export class ReferralBonusService {
    private static readonly UNIQUE_AMOUNTS_BY_LEVEL: Record<number, number> = {
        1: 10,
        2: 5,
        3: 5,
    };

    private static readonly RECURRENT_AMOUNTS_BY_LEVEL: Record<number, number> = {
        1: 10,
        2: 5,
        3: 5,
    };

    constructor(
        private readonly userRepository: IUserRepository,
        private readonly referralRepository: IReferralRepository,
    ) {}

    // ---------------------------------------------------------------------
    // 🔒 FASE 4 — BLOQUEIO POR INADIMPLÊNCIA
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
    // FASE 2 — BÔNUS UNIQUE (primeiro pagamento PAID)
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

        // 🔒 BLOQUEIO POR INADIMPLÊNCIA
        if (await this.payerIsInDefault(payerId)) {
            return;
        }

        const alreadyGenerated =
            await this.referralRepository.hasUniqueBonusForPayerSubscription(
                payerId,
                subscriptionId,
            );

        if (alreadyGenerated) return;

        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        let currentUser: any = payer;

        for (let level = 1; level <= 3; level++) {
            const referrerId = currentUser?.referrerId ?? null;
            if (!referrerId || referrerId <= 0) break;

            const referrer = await this.userRepository.findById(referrerId, false);
            if (this.isUserEligible(referrer)) {
                await this.safeSaveBonus(
                    new ReferralBonus({
                        id: 0,
                        receiverId: referrerId,
                        payerId,
                        level,
                        type: "UNIQUE",
                        amount:
                            ReferralBonusService.UNIQUE_AMOUNTS_BY_LEVEL[level] ??
                            0,
                        paymentStatus: "PAID",
                        paymentId,
                        eventKey: this.buildUniqueEventKey({
                            payerId,
                            subscriptionId,
                            level,
                            receiverId: referrerId,
                        }),
                    }),
                );
            }

            currentUser = referrer;
        }
    }

    // ---------------------------------------------------------------------
    // FASE 3 — BÔNUS RECURRENT (por competência)
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

        // 🔒 BLOQUEIO POR INADIMPLÊNCIA
        if (await this.payerIsInDefault(payerId)) {
            return;
        }

        const competenceYearMonth = this.toCompetenceYearMonth(
            paymentDate,
            offset,
        );

        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        let currentUser: any = payer;

        for (let level = 1; level <= 3; level++) {
            const referrerId = currentUser?.referrerId ?? null;
            if (!referrerId || referrerId <= 0) break;

            const referrer = await this.userRepository.findById(referrerId, false);
            if (this.isUserEligible(referrer)) {
                await this.safeSaveBonus(
                    new ReferralBonus({
                        id: 0,
                        receiverId: referrerId,
                        payerId,
                        level,
                        type: "RECURRENT",
                        amount:
                            ReferralBonusService.RECURRENT_AMOUNTS_BY_LEVEL[level] ??
                            0,
                        paymentStatus: "PAID",
                        competenceYearMonth,
                        paymentId,
                        eventKey: this.buildRecurrentEventKey({
                            competenceYearMonth,
                            payerId,
                            level,
                            receiverId: referrerId,
                        }),
                    }),
                );
            }

            currentUser = referrer;
        }
    }

    // ---------------------------------------------------------------------
    // HELPERS
    // ---------------------------------------------------------------------

    private isUserEligible(user: any): boolean {
        if (!user) return false;
        const status = user?.status;
        if (!status) return true;
        return status === "ACTIVE";
    }

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

    private async safeSaveBonus(referralBonus: ReferralBonus): Promise<void> {
        try {
            await this.referralRepository.save(referralBonus);
        } catch (err: any) {
            const msg = String(err?.message ?? "");
            const code = String(err?.code ?? "");

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
}
