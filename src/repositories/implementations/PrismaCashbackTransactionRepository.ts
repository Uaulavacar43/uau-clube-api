// src/repositories/prisma/PrismaCashbackTransactionRepository.ts

import prisma from "../../config/dbConfig";
import { Prisma } from "@prisma/client";
import { CashbackTransaction } from "../../entities/CashbackTransaction";
import type {
    CashbackTransactionCreateInput,
    ICashbackTransactionRepository,
} from "../interfaces/ICashbackTransactionRepository";

export class PrismaCashbackTransactionRepository implements ICashbackTransactionRepository {
    // ------------------------------------------------------------------
    // Helpers (sem repetir lógica)
    // ------------------------------------------------------------------

    private normalizeMeta(meta?: Prisma.InputJsonValue | null) {
        if (meta === undefined) return undefined;
        if (meta === null) return Prisma.JsonNull;
        return meta;
    }

    private toEntity(r: any): CashbackTransaction {
        return new CashbackTransaction({
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
        });
    }

    // ------------------------------------------------------------------
    // Interface
    // ------------------------------------------------------------------

    async existsByEventKey(eventKey: string): Promise<boolean> {
        if (!eventKey) return false;

        // ✅ mais leve que count()
        const found = await prisma.cashbackTransaction.findUnique({
            where: { eventKey },
            select: { id: true },
        });

        return !!found;
    }

    async findByEventKey(eventKey: string): Promise<CashbackTransaction | null> {
        if (!eventKey) return null;

        const row = await prisma.cashbackTransaction.findUnique({
            where: { eventKey },
        });

        return row ? this.toEntity(row) : null;
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

                meta: this.normalizeMeta(data.meta),

                expiresAt: data.expiresAt ?? null,
            },
        });

        return this.toEntity(created);
    }

    async findByUserId(userId: number): Promise<CashbackTransaction[]> {
        const rows = await prisma.cashbackTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        return rows.map((r) => this.toEntity(r));
    }
}
