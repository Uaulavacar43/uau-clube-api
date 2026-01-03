import { TransactionType } from "@prisma/client";

export type TxLike = {
    type: TransactionType;
    amount: unknown;
    expiresAt?: unknown;
    eventKey?: string | null;
};

export class CashbackPolicy {
    static normalizeMoney(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Number(n.toFixed(2));
    }

    static toDate(value: unknown): Date | null {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    static isExpired(expiresAt: unknown, now: Date): boolean {
        const d = this.toDate(expiresAt);
        return d ? d.getTime() <= now.getTime() : false;
    }

    static computeBalance(txs: TxLike[], now: Date) {
        let earnedValid = 0;
        let earnedExpired = 0;
        let usedTotal = 0;

        for (const tx of txs) {
            const amount = this.normalizeMoney(tx.amount);

            if (tx.type === TransactionType.EARNED) {
                if (this.isExpired(tx.expiresAt, now)) earnedExpired += amount;
                else earnedValid += amount;
            }

            if (tx.type === TransactionType.USED) usedTotal += amount;
        }

        earnedValid = Number(earnedValid.toFixed(2));
        earnedExpired = Number(earnedExpired.toFixed(2));
        usedTotal = Number(usedTotal.toFixed(2));

        const raw = earnedValid - usedTotal;
        const availableBalance = raw < 0 ? 0 : Number(raw.toFixed(2));

        return { earnedValid, earnedExpired, usedTotal, availableBalance };
    }
}
