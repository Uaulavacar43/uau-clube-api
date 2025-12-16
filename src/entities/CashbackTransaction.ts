import type { TransactionType, TransactionSource } from "@prisma/client";

export interface CashbackTransactionProps {
    id?: number;
    userId: number;
    type: TransactionType;      // EARNED | USED
    source: TransactionSource;  // INDICATION | PAYMENT | SYSTEM
    amount: number;
    relatedId?: string | null;
    eventKey?: string | null;
    meta?: unknown;
    createdAt?: Date;
}

export class CashbackTransaction {
    public readonly id: number | null;
    public readonly userId: number;
    public readonly type: TransactionType;
    public readonly source: TransactionSource;
    public readonly amount: number;
    public readonly relatedId: string | null;
    public readonly eventKey: string | null;
    public readonly meta?: unknown;
    public readonly createdAt: Date;

    constructor(props: CashbackTransactionProps) {
        if (!props) throw new Error("CashbackTransactionProps é obrigatório.");

        if (!Number.isInteger(props.userId) || props.userId <= 0) {
            throw new Error("userId inválido.");
        }

        if (props.amount <= 0) {
            throw new Error("amount deve ser maior que zero.");
        }

        this.id = props.id ?? null;
        this.userId = props.userId;
        this.type = props.type;
        this.source = props.source;
        this.amount = props.amount;
        this.relatedId = props.relatedId ?? null;
        this.eventKey = props.eventKey ?? null;
        this.meta = props.meta;
        this.createdAt = props.createdAt ?? new Date();
    }
}
