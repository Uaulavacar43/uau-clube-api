import type { Prisma, TransactionSource, TransactionType } from "@prisma/client";
import type { CashbackTransaction } from "../../entities/CashbackTransaction";

export type CashbackTransactionCreateInput = {
    userId: number;
    type: TransactionType;
    source: TransactionSource;
    amount: number;

    relatedId?: string | null;
    eventKey?: string | null;

    // Json? no Prisma NÃO aceita null diretamente no create input,
    // então deixamos (InputJsonValue | null) e o repo converte null -> Prisma.JsonNull
    meta?: Prisma.InputJsonValue | null;

    expiresAt?: Date | null;
};

export interface ICashbackTransactionRepository {
    create(data: CashbackTransactionCreateInput): Promise<CashbackTransaction>;

    existsByEventKey(eventKey: string): Promise<boolean>;

    findByUserId(userId: number): Promise<CashbackTransaction[]>;
}
