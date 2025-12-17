import prisma from "../../config/dbConfig";
import { Prisma } from "@prisma/client";
import { CashbackTransaction } from "../../entities/CashbackTransaction";
import type {
    CashbackTransactionCreateInput,
    ICashbackTransactionRepository,
} from "../interfaces/ICashbackTransactionRepository";

export class PrismaCashbackTransactionRepository
    implements ICashbackTransactionRepository
{
    async existsByEventKey(eventKey: string): Promise<boolean> {
        const count = await prisma.cashbackTransaction.count({ where: { eventKey } });
        return count > 0;
    }

    async create(data: CashbackTransactionCreateInput): Promise<CashbackTransaction> {
        const created = await prisma.cashbackTransaction.create({
            data: {
                userId: data.userId,
                type: data.type,
                source: data.source,
                amount: data.amount,

                relatedId: data.relatedId ?? null,
                eventKey: data.eventKey ?? null,

                // Json? no create input: null precisa virar Prisma.JsonNull
                meta:
                    data.meta === undefined
                        ? undefined
                        : data.meta === null
                            ? Prisma.JsonNull
                            : data.meta,

                expiresAt: data.expiresAt ?? null,
            },
        });

        return new CashbackTransaction({
            id: created.id,
            userId: created.userId,
            type: created.type,
            source: created.source,
            amount: created.amount,
            relatedId: created.relatedId ?? null,
            eventKey: created.eventKey ?? null,
            meta: created.meta ?? null,
            expiresAt: created.expiresAt ?? null,
            createdAt: created.createdAt,
        });
    }

    async findByUserId(userId: number): Promise<CashbackTransaction[]> {
        const rows = await prisma.cashbackTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        return rows.map(
            (r) =>
                new CashbackTransaction({
                    id: r.id,
                    userId: r.userId,
                    type: r.type,
                    source: r.source,
                    amount: r.amount,
                    relatedId: r.relatedId ?? null,
                    eventKey: r.eventKey ?? null,
                    meta: r.meta ?? null,
                    expiresAt: r.expiresAt ?? null,
                    createdAt: r.createdAt,
                }),
        );
    }
}
