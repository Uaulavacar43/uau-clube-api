import prisma from "../../config/dbConfig";
import { ReferralBonus } from "../../entities/ReferralBonus";
import type { IReferralRepository } from "../interfaces/IReferralRepository";

export class PrismaReferralBonusRepository implements IReferralRepository {
    public async hasUniqueBonusForPayerSubscription(
        payerId: number,
        subscriptionId: number,
    ): Promise<boolean> {
        if (!Number.isInteger(payerId) || payerId <= 0) return false;
        if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) return false;

        // Baseado no padrão de eventKey que você definiu na entidade:
        // `UNIQUE:SUB:${subscriptionId}:PAYER:${payerId}:L${level}`
        const prefix = `UNIQUE:SUB:${subscriptionId}:PAYER:${payerId}:`;

        const found = await prisma.referralBonus.findFirst({
            where: {
                type: "UNIQUE",
                eventKey: { startsWith: prefix },
            },
            select: { id: true },
        });

        return Boolean(found?.id);
    }

    public async save(referralBonus: ReferralBonus): Promise<ReferralBonus> {
        /**
         * 🔐 CONTRATO:
         * - eventKey deve estar definido aqui
         * - idempotência garantida pelo UNIQUE no banco (eventKey UNIQUE)
         */
        if (!referralBonus.eventKey || referralBonus.eventKey.trim().length === 0) {
            throw new Error("eventKey é obrigatório para persistir ReferralBonus");
        }

        try {
            const created = await prisma.referralBonus.create({
                data: {
                    receiverId: referralBonus.receiverId,
                    payerId: referralBonus.payerId,
                    level: referralBonus.level,
                    type: referralBonus.type,
                    amount: referralBonus.amount,
                    paymentStatus: referralBonus.paymentStatus,

                    eventKey: referralBonus.eventKey,
                    competenceYearMonth: referralBonus.competenceYearMonth ?? null,
                    paymentId: referralBonus.paymentId ?? null,
                },
            });

            return new ReferralBonus({
                id: created.id,
                receiverId: created.receiverId,
                payerId: created.payerId,
                level: created.level,
                type: created.type as any,
                amount: created.amount,
                paymentStatus: created.paymentStatus as any,
                eventKey: created.eventKey ?? undefined,
                competenceYearMonth: created.competenceYearMonth ?? undefined,
                paymentId: created.paymentId ?? undefined,
                createdAt: created.createdAt,
                updatedAt: created.updatedAt,
            });
        } catch (err: any) {
            /**
             * Idempotência real:
             * Se já existir (UNIQUE violation), busca pelo eventKey e retorna o existente.
             * Prisma: código P2002 = Unique constraint failed.
             */
            if (err?.code === "P2002") {
                const existing = await prisma.referralBonus.findUnique({
                    where: { eventKey: referralBonus.eventKey },
                });

                if (!existing) {
                    // Caso extremo: falhou no create por unique, mas não encontrou no select
                    throw err;
                }

                return new ReferralBonus({
                    id: existing.id,
                    receiverId: existing.receiverId,
                    payerId: existing.payerId,
                    level: existing.level,
                    type: existing.type as any,
                    amount: existing.amount,
                    paymentStatus: existing.paymentStatus as any,
                    eventKey: existing.eventKey ?? undefined,
                    competenceYearMonth: existing.competenceYearMonth ?? undefined,
                    paymentId: existing.paymentId ?? undefined,
                    createdAt: existing.createdAt,
                    updatedAt: existing.updatedAt,
                });
            }

            throw err;
        }
    }
}
