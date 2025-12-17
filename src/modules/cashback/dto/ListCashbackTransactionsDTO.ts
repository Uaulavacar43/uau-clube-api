import type { TransactionSource, TransactionType } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import type { CashbackTransaction } from "../../../entities/CashbackTransaction";

type TransactionRow = {
    id: number;
    userId: number;
    type: TransactionType;
    source: TransactionSource;
    amount: number;
    relatedId: string | null;
    eventKey: string | null;
    meta: JsonValue | null;
    expiresAt: Date | null;
    createdAt: Date;
    isExpired: boolean;
};

type ListCashbackTransactionsDTOProps = {
    transactions: TransactionRow[];
    now: Date;
    includeExpired: boolean;
};

export class ListCashbackTransactionsDTO {
    // `declare` evita erro de "no initializer" e não briga com noUnusedLocals
    public declare readonly transactions: TransactionRow[];
    public declare readonly now: Date;
    public declare readonly includeExpired: boolean;

    private constructor(props: ListCashbackTransactionsDTOProps) {
        Object.assign(this, props);
    }

    public static from(params: {
        transactions: CashbackTransaction[];
        now: Date;
        includeExpired: boolean;
    }): ListCashbackTransactionsDTO {
        const mapped: TransactionRow[] = params.transactions.map((tx) => {
            if (tx.id == null) throw new Error("CashbackTransaction.id não pode ser null ao montar DTO.");
            if (tx.createdAt == null)
                throw new Error("CashbackTransaction.createdAt não pode ser null ao montar DTO.");

            const expiresAt = tx.expiresAt ?? null;
            const isExpired =
                tx.type === "EARNED" && expiresAt
                    ? expiresAt.getTime() <= params.now.getTime()
                    : false;

            return {
                id: tx.id,
                userId: tx.userId,
                type: tx.type,
                source: tx.source,
                amount: tx.amount,
                relatedId: tx.relatedId ?? null,
                eventKey: tx.eventKey ?? null,
                meta: (tx.meta as JsonValue) ?? null,
                expiresAt,
                createdAt: tx.createdAt,
                isExpired,
            };
        });

        return new ListCashbackTransactionsDTO({
            transactions: mapped,
            now: params.now,
            includeExpired: params.includeExpired,
        });
    }

    /**
     * Importante: Express (res.json) usa JSON.stringify.
     * JSON.stringify chama automaticamente toJSON() quando existe.
     * E isso também "usa" os campos, evitando warning de unused fields.
     */
    public toJSON() {
        return {
            transactions: this.transactions,
            now: this.now,
            includeExpired: this.includeExpired,
        };
    }
}
