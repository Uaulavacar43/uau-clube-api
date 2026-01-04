// src/modules/payment/PaymentMetricsService.ts
import prisma from "../../config/dbConfig";

type RevenuePoint = { period: string; revenue: number };

export class PaymentMetricsService {
    private startOfMonth(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    }

    private endOfMonth(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
    }

    private formatYYYYMM(d: Date): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}`;
    }

    private formatYYYY(d: Date): string {
        return String(d.getFullYear());
    }

    public async getTotalRevenue(): Promise<number> {
        const agg = await prisma.payment.aggregate({
            where: { status: "PAID" },
            _sum: { amount: true },
        });

        return Number(agg._sum.amount ?? 0);
    }

    public async getCurrentMonthRevenue(): Promise<number> {
        const now = new Date();
        const from = this.startOfMonth(now);
        const to = this.endOfMonth(now);

        const agg = await prisma.payment.aggregate({
            where: {
                status: "PAID",
                paymentDate: {
                    gte: from,
                    lt: to,
                },
            },
            _sum: { amount: true },
        });

        return Number(agg._sum.amount ?? 0);
    }

    /**
     * Melhor decisão sem inventar tabela de assinatura:
     * - MRR aqui = soma de cobranças pagas de "plano" no mês atual (planId != null).
     * Se teu sistema tiver uma tabela de assinatura ativa, dá pra evoluir depois.
     */
    public async getMRR(): Promise<number> {
        const now = new Date();
        const from = this.startOfMonth(now);
        const to = this.endOfMonth(now);

        const agg = await prisma.payment.aggregate({
            where: {
                status: "PAID",
                planId: { not: null },
                paymentDate: {
                    gte: from,
                    lt: to,
                },
            },
            _sum: { amount: true },
        });

        return Number(agg._sum.amount ?? 0);
    }

    /**
     * Predição simples: usa MRR atual como proxy do próximo mês.
     * (Mantém estável e sem inventar modelo estatístico)
     */
    public async getNextMonthPredictedRevenue(): Promise<number> {
        return this.getMRR();
    }

    public async getMonthlyRevenueHistory(months: number = 12): Promise<RevenuePoint[]> {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
        const end = this.endOfMonth(now);

        const payments = await prisma.payment.findMany({
            where: {
                status: "PAID",
                paymentDate: {
                    gte: start,
                    lt: end,
                },
            },
            select: {
                paymentDate: true,
                amount: true,
            },
        });

        const buckets = new Map<string, number>();

        for (const p of payments) {
            const key = this.formatYYYYMM(p.paymentDate);
            const current = buckets.get(key) ?? 0;
            buckets.set(key, current + Number(p.amount));
        }

        const points: RevenuePoint[] = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
            const key = this.formatYYYYMM(d);
            points.push({ period: key, revenue: buckets.get(key) ?? 0 });
        }

        return points;
    }

    public async getYearlyRevenueHistory(years: number = 5): Promise<RevenuePoint[]> {
        const now = new Date();
        const start = new Date(now.getFullYear() - (years - 1), 0, 1, 0, 0, 0, 0);
        const end = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);

        const payments = await prisma.payment.findMany({
            where: {
                status: "PAID",
                paymentDate: {
                    gte: start,
                    lt: end,
                },
            },
            select: {
                paymentDate: true,
                amount: true,
            },
        });

        const buckets = new Map<string, number>();

        for (const p of payments) {
            const key = this.formatYYYY(p.paymentDate);
            const current = buckets.get(key) ?? 0;
            buckets.set(key, current + Number(p.amount));
        }

        const points: RevenuePoint[] = [];
        for (let i = 0; i < years; i++) {
            const y = start.getFullYear() + i;
            const key = String(y);
            points.push({ period: key, revenue: buckets.get(key) ?? 0 });
        }

        return points;
    }
}
