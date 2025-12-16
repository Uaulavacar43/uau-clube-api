import prisma from "../../config/dbConfig";
import { ReferralBonus, type PaymentStatus } from "../../entities/ReferralBonus";
import type {
    IReferralRepository,
    ReferralBonusListResult,
} from "../interfaces/IReferralRepository";

export class PrismaReferralBonusRepository implements IReferralRepository {
    private toEntity(raw: any): ReferralBonus {
        return new ReferralBonus({
            id: raw.id,
            receiverId: raw.receiverId,
            payerId: raw.payerId,
            level: raw.level,
            type: raw.type,
            amount: Number(raw.amount),
            paymentStatus: raw.paymentStatus,
            eventKey: raw.eventKey,
            competenceYearMonth: raw.competenceYearMonth ?? undefined,
            paymentId: raw.paymentId ?? undefined,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
        });
    }

    public async save(referralBonus: ReferralBonus): Promise<ReferralBonus> {
        /**
         * 🔐 CONTRATO:
         * - eventKey deve estar definido aqui
         * - idempotência garantida pelo UNIQUE no banco
         */
        if (!referralBonus.eventKey) {
            throw new Error("eventKey é obrigatório para persistir ReferralBonus");
        }

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

        return this.toEntity(created);
    }

    public async existsByEventKey(eventKey: string): Promise<boolean> {
        if (!eventKey || !eventKey.trim()) return false;

        const found = await prisma.referralBonus.findUnique({
            where: { eventKey },
            select: { id: true },
        });

        return Boolean(found?.id);
    }

    public async hasUniqueBonusForPayerSubscription(
        payerId: number,
        subscriptionId: number,
    ): Promise<boolean> {
        if (!payerId || payerId <= 0) return false;
        if (!subscriptionId || subscriptionId <= 0) return false;

        /**
         * Padronização necessária no service:
         * UNIQUE:sub:{subscriptionId}:payer:{payerId}:...
         */
        const prefix = `UNIQUE:sub:${subscriptionId}:payer:${payerId}`;

        const found = await prisma.referralBonus.findFirst({
            where: {
                payerId,
                type: "UNIQUE",
                eventKey: { startsWith: prefix },
            },
            select: { id: true },
        });

        return Boolean(found?.id);
    }

    public async hasRecurrentBonusForPayerPayment(
        payerId: number,
        paymentId: number,
        competenceYearMonth: string,
    ): Promise<boolean> {
        if (!payerId || payerId <= 0) return false;
        if (!paymentId || paymentId <= 0) return false;

        const comp = (competenceYearMonth ?? "").trim();
        if (!comp) return false;

        /**
         * Padronização no service:
         * RECURRENT:${YYYY-MM}:payer:${payerId}:payment:${paymentId}:...
         */
        const prefix = `RECURRENT:${comp}:payer:${payerId}:payment:${paymentId}`;

        const found = await prisma.referralBonus.findFirst({
            where: {
                payerId,
                type: "RECURRENT",
                competenceYearMonth: comp,
                paymentId,
                eventKey: { startsWith: prefix },
            },
            select: { id: true },
        });

        return Boolean(found?.id);
    }

    public async listByReceiver(
        receiverId: number,
        page: number,
        pageSize: number,
        filter?: {
            type?: "UNIQUE" | "RECURRENT";
            paymentStatus?: PaymentStatus;
            competenceYearMonth?: string;
        },
    ): Promise<ReferralBonusListResult> {
        const rid = Number(receiverId);
        const p = Number(page);
        const ps = Number(pageSize);

        if (!rid || rid <= 0) {
            return { total: 0, data: [] };
        }

        const safePage = !p || p <= 0 ? 1 : p;
        const safePageSize = !ps || ps <= 0 ? 10 : ps;

        const where: any = {
            receiverId: rid,
        };

        if (filter?.type) where.type = filter.type;
        if (filter?.paymentStatus) where.paymentStatus = filter.paymentStatus;
        if (filter?.competenceYearMonth) {
            where.competenceYearMonth = filter.competenceYearMonth.trim();
        }

        const [total, rows] = await Promise.all([
            prisma.referralBonus.count({ where }),
            prisma.referralBonus.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (safePage - 1) * safePageSize,
                take: safePageSize,
            }),
        ]);

        return {
            total,
            data: rows.map((r) => this.toEntity(r)),
        };
    }

    public async updateStatus(id: number, paymentStatus: PaymentStatus): Promise<void> {
        const bonusId = Number(id);
        if (!bonusId || Number.isNaN(bonusId)) return;

        await prisma.referralBonus.update({
            where: { id: bonusId },
            data: { paymentStatus },
        });
    }
}
