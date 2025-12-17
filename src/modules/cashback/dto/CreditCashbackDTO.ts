import type { Prisma, TransactionSource, TransactionType } from "@prisma/client";

export class CreditCashbackDTO {
    public readonly userId: number;
    public readonly type: TransactionType;
    public readonly source: TransactionSource;
    public readonly amount: number;
    public readonly relatedId: string | null;
    public readonly eventKey: string;
    public readonly meta?: Prisma.InputJsonValue;
    public readonly expiresAt: Date | null;

    constructor(params: {
        userId: number;
        amount: number;
        source: TransactionSource;
        eventKey: string;
        relatedId?: string | null;
        meta?: Prisma.InputJsonValue;
        expiresAt?: Date | null;
    }) {
        this.userId = params.userId;
        this.type = "EARNED" as TransactionType;
        this.source = params.source;
        this.amount = params.amount;
        this.relatedId = params.relatedId ?? null;
        this.eventKey = params.eventKey;
        this.meta = params.meta;
        this.expiresAt = params.expiresAt ?? null;
    }
}
