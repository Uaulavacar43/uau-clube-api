// src/modules/payment/services/CashbackService.ts


import { AppError } from "../../error/AppError";

import prisma from "../../config/dbConfig";
import { TransactionSource, TransactionType, WalletType } from "@prisma/client";

import {PaymentPolicy} from "./PaymentPolicy";

/**
 * Serviço responsável por regras de Cashback (FASE 4):
 * - Saldo disponível = earned (não expirado) - used
 * - Respeita expiração (expiresAt)
 * - Regra: cashback máximo = 50% do total (após cupom)
 * - Regra: não pode reduzir abaixo do mínimo de cobrança
 * - NÃO debita no create (apenas calcula e retorna cashbackUsed)
 * - Debita APENAS quando pagamento for PAID (webhook), de forma idempotente
 *
 * IMPORTANTE:
 * Este serviço foi extraído do PaymentService e deve manter a lógica 100% idêntica.
 */
export class CashbackService {
    public async computeCashbackAvailability(
        userId: number,
        now: Date,
    ): Promise<{
        earnedValid: number;
        earnedExpired: number;
        usedTotal: number;
        availableBalance: number;
    }> {
        const rows = await prisma.cashbackTransaction.findMany({
            where: { userId },
            select: {
                type: true,
                amount: true,
                expiresAt: true,
            },
        });

        let earnedValid = 0;
        let earnedExpired = 0;
        let usedTotal = 0;

        for (const tx of rows) {
            const amount = Number(tx.amount ?? 0);

            if (tx.type === TransactionType.EARNED) {
                const expiresAt = tx.expiresAt ? new Date(tx.expiresAt) : null;
                const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;

                if (isExpired) earnedExpired += amount;
                else earnedValid += amount;
            }

            if (tx.type === TransactionType.USED) {
                usedTotal += amount;
            }
        }

        const rawAvailable = earnedValid - usedTotal;
        const availableBalance = rawAvailable < 0 ? 0 : Number(rawAvailable.toFixed(2));

        return {
            earnedValid: Number(earnedValid.toFixed(2)),
            earnedExpired: Number(earnedExpired.toFixed(2)),
            usedTotal: Number(usedTotal.toFixed(2)),
            availableBalance,
        };
    }

    public async getOrCreateInternalWalletByUserId(userId: number): Promise<{
        id: number;
        userId: number;
        type: WalletType;
        balance: number;
    }> {
        const wallet = await prisma.cashbackWallet.upsert({
            where: {
                userId_type: {
                    userId,
                    type: WalletType.INTERNAL,
                },
            },
            update: {},
            create: {
                userId,
                type: WalletType.INTERNAL,
                balance: 0,
            },
            select: {
                id: true,
                userId: true,
                type: true,
                balance: true,
            },
        });

        return {
            id: wallet.id,
            userId: wallet.userId,
            type: wallet.type,
            balance: Number(wallet.balance ?? 0),
        };
    }

    /**
     * Regra de cashback aplicada NO MOMENTO DE CRIAÇÃO DA COBRANÇA:
     * - não deixa o pagamento ficar abaixo do mínimo
     * - limita cashback em 50% do total (após cupom)
     * - usa saldo disponível real (earned válido - used), respeitando expiresAt
     *
     * Importante: aqui NÃO debita do wallet (apenas calcula e persiste em Payment.cashbackUsedAmount).
     * O débito acontece no webhook quando PAID (idempotente).
     */
    public async resolveCashbackUsageOrThrow(params: {
        userId: number;
        requestedCashback: number;
        amountAfterCoupon: number; // total após cupom, antes do cashback
        minimumCharge: number;
    }): Promise<{
        cashbackUsed: number;
        amountAfterCashback: number;
        wallet: { id: number; balance: number };
        availableBalance: number;
    }> {
        const requested = PaymentPolicy.parseCashbackAmount(params.requestedCashback);

        const minCharge = PaymentPolicy.ensureMinimumAmount(
            params.minimumCharge,
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
        );

        const amountAfterCoupon = PaymentPolicy.ensureMinimumAmount(
            params.amountAfterCoupon,
            minCharge,
        );

        if (requested <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: 0, balance: 0 },
                availableBalance: 0,
            };
        }

        const wallet = await this.getOrCreateInternalWalletByUserId(params.userId);

        const now = new Date();
        const availability = await this.computeCashbackAvailability(params.userId, now);

        if (availability.availableBalance <= 0) {
            throw new AppError("Saldo de cashback indisponível", 400);
        }

        // Regra 1: não pode reduzir abaixo do mínimo
        const maxByMinCharge = Math.max(0, amountAfterCoupon - minCharge);

        // Regra 2: 50% do total (após cupom)
        const maxByRule50 = Math.max(0, amountAfterCoupon * 0.5);

        // Limite final
        const maxAllowed = Math.min(maxByMinCharge, maxByRule50);

        if (maxAllowed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: wallet.balance },
                availableBalance: availability.availableBalance,
            };
        }

        const cashbackUsed = Math.min(
            availability.availableBalance,
            requested,
            maxAllowed,
        );

        if (cashbackUsed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: wallet.balance },
                availableBalance: availability.availableBalance,
            };
        }

        const amountAfterCashback = PaymentPolicy.ensureMinimumAmount(
            amountAfterCoupon - cashbackUsed,
            minCharge,
        );

        return {
            cashbackUsed: Number(cashbackUsed.toFixed(2)),
            amountAfterCashback,
            wallet: { id: wallet.id, balance: wallet.balance },
            availableBalance: availability.availableBalance,
        };
    }

    /**
     * Débito idempotente no PAID:
     * - Usa eventKey único por paymentIdAsaas
     * - Verifica saldo disponível real (respeitando expiresAt)
     * - Decrementa wallet e registra CashbackTransaction.USED
     */
    public async debitCashbackIdempotentOnPaid(params: {
        userId: number;
        amount: number;
        paymentIdAsaas: string;
        paymentIdLocal?: number | null;
        meta?: Record<string, any>;
    }): Promise<void> {
        const amountToDebit = PaymentPolicy.parseCashbackAmount(params.amount);
        if (amountToDebit <= 0) return;

        const eventKey = `CASHBACK_DEBIT:ASAAS_PAYMENT:${params.paymentIdAsaas}`;

        await prisma.$transaction(async (tx) => {
            const wallet = await tx.cashbackWallet.upsert({
                where: {
                    userId_type: {
                        userId: params.userId,
                        type: WalletType.INTERNAL,
                    },
                },
                update: {},
                create: {
                    userId: params.userId,
                    type: WalletType.INTERNAL,
                    balance: 0,
                },
                select: {
                    id: true,
                    balance: true,
                },
            });

            const existingTx = await tx.cashbackTransaction.findUnique({
                where: { eventKey },
                select: { id: true },
            });

            if (existingTx) {
                return;
            }

            const now = new Date();

            const userTxs = await tx.cashbackTransaction.findMany({
                where: { userId: params.userId },
                select: {
                    type: true,
                    amount: true,
                    expiresAt: true,
                },
            });

            let earnedValid = 0;
            let usedTotal = 0;

            for (const t of userTxs) {
                const a = Number(t.amount ?? 0);

                if (t.type === TransactionType.EARNED) {
                    const expiresAt = t.expiresAt ? new Date(t.expiresAt) : null;
                    const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
                    if (!isExpired) earnedValid += a;
                }

                if (t.type === TransactionType.USED) {
                    usedTotal += a;
                }
            }

            const availableBalance = Math.max(0, earnedValid - usedTotal);

            const walletBalance = Number(wallet.balance ?? 0);

            if (availableBalance < amountToDebit) {
                throw new AppError(
                    "Saldo de cashback insuficiente (saldo disponível real) para debitar no pagamento confirmado",
                    409,
                );
            }

            if (walletBalance < amountToDebit) {
                throw new AppError(
                    "Saldo de wallet insuficiente para debitar no pagamento confirmado",
                    409,
                );
            }

            await tx.cashbackWallet.update({
                where: { id: wallet.id },
                data: {
                    balance: {
                        decrement: amountToDebit,
                    },
                },
            });

            await tx.cashbackTransaction.create({
                data: {
                    userId: params.userId,
                    type: TransactionType.USED,
                    source: TransactionSource.SUBSCRIPTION_DEBIT,
                    amount: amountToDebit,
                    relatedId: params.paymentIdAsaas,
                    eventKey,
                    meta: {
                        paymentIdLocal: params.paymentIdLocal ?? null,
                        paymentIdAsaas: params.paymentIdAsaas,
                        ...(params.meta ?? {}),
                    },
                    expiresAt: null,
                },
            });
        });
    }
}
