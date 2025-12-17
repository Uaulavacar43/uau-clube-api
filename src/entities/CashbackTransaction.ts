import type { Prisma, TransactionSource, TransactionType } from "@prisma/client";

export type CashbackTransactionProps = {
    id: number;
    userId: number;
    type: TransactionType;      // EARNED | USED
    source: TransactionSource;  // WELCOME_BONUS | INDICATION | ...
    amount: number;

    relatedId: string | null;
    eventKey: string | null;

    meta: Prisma.JsonValue | null;

    // Fase 4
    expiresAt: Date | null;

    createdAt: Date;
};

export class CashbackTransaction {
    public readonly id: number;
    public readonly userId: number;
    public readonly type: TransactionType;
    public readonly source: TransactionSource;
    public readonly amount: number;

    public readonly relatedId: string | null;
    public readonly eventKey: string | null;
    public readonly meta: Prisma.JsonValue | null;

    public readonly expiresAt: Date | null;
    public readonly createdAt: Date;

    constructor(props: CashbackTransactionProps) {
        if (!props) throw new Error("CashbackTransactionProps é obrigatório.");

        if (!Number.isInteger(props.id) || props.id <= 0) {
            throw new Error("id inválido (CashbackTransaction deve vir persistido do banco).");
        }

        if (!Number.isInteger(props.userId) || props.userId <= 0) {
            throw new Error("userId inválido.");
        }

        if (props.amount <= 0) {
            throw new Error("amount deve ser maior que zero.");
        }

        this.id = props.id;
        this.userId = props.userId;
        this.type = props.type;
        this.source = props.source;
        this.amount = props.amount;

        this.relatedId = props.relatedId ?? null;
        this.eventKey = props.eventKey ?? null;
        this.meta = props.meta ?? null;

        this.expiresAt = props.expiresAt ?? null;
        this.createdAt = props.createdAt ?? new Date();
    }

    public toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            type: this.type,
            source: this.source,
            amount: this.amount,
            relatedId: this.relatedId,
            eventKey: this.eventKey,
            meta: this.meta,
            expiresAt: this.expiresAt,
            createdAt: this.createdAt,
        };
    }
}
