
import { CashbackTransaction } from "../../entities/CashbackTransaction";
import type { ICashbackTransactionRepository } from "../interfaces/ICashbackTransactionRepository";
import prisma from "../../config/dbConfig";

export class PrismaCashbackTransactionRepository
    implements ICashbackTransactionRepository
{
    async existsByEventKey(eventKey: string): Promise<boolean> {
        const count = await prisma.cashbackTransaction.count({
            where: { eventKey },
        });
        return count > 0;
    }

    async create(
        data: Omit<CashbackTransaction, "id" | "createdAt">,
    ): Promise<CashbackTransaction> {
        const created = await prisma.cashbackTransaction.create({
            data: {
                userId: data.userId,
                type: data.type,
                source: data.source,
                amount: data.amount,
                relatedId: data.relatedId,
                eventKey: data.eventKey,
                meta: data.meta ?? undefined,
            },
        });

        return new CashbackTransaction(created);
    }

    async findByUserId(userId: number): Promise<CashbackTransaction[]> {
        const rows = await prisma.cashbackTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        return rows.map((r) => new CashbackTransaction(r));
    }
}
