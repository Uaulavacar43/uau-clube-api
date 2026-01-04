// src/modules/payment/services/PaymentCashbackService.ts

import { AppError } from "../../error/AppError";
import prisma from "../../config/dbConfig";
import { TransactionSource, TransactionType, WalletType } from "@prisma/client";

import { PaymentPolicy } from "./PaymentPolicy";

// ajuste o caminho se tua pasta for diferente
import { CashbackPolicy, type TxLike } from "../cashback/CashbackPolicy";

/**
 * Serviço responsável por regras de Cashback no módulo Payment:
 * - Resolve uso no CREATE (não debita, só calcula cashbackUsed)
 * - Débito idempotente no webhook PAID
 * - Crédito idempotente no webhook PAID (quando aplicável)
 *
 * Fonte da verdade para saldo/expiração/normalização: CashbackPolicy
 *
 * IMPORTANTE:
 * Este serviço foi extraído do PaymentService e deve manter a lógica 100% idêntica,
 * apenas removendo repetição e conflitos de responsabilidade.
 */
export class PaymentCashbackService {
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

        const txs: TxLike[] = rows.map((r) => ({
            type: r.type,
            amount: r.amount,
            expiresAt: r.expiresAt,
            eventKey: null,
        }));

        return CashbackPolicy.computeBalance(txs, now);
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
     * Aqui NÃO debita do wallet. Apenas calcula e retorna cashbackUsed/amountAfterCashback.
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

        const amountAfterCoupon = PaymentPolicy.ensureMinimumAmount(params.amountAfterCoupon, minCharge);

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

        const maxAllowed = Math.min(maxByMinCharge, maxByRule50);

        if (maxAllowed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: wallet.balance },
                availableBalance: availability.availableBalance,
            };
        }

        const cashbackUsedRaw = Math.min(availability.availableBalance, requested, maxAllowed);
        const cashbackUsed = Number(cashbackUsedRaw.toFixed(2));

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
            cashbackUsed,
            amountAfterCashback,
            wallet: { id: wallet.id, balance: wallet.balance },
            availableBalance: availability.availableBalance,
        };
    }

    // ---------------------------------------------------------------------
    // Event keys padronizados
    // ---------------------------------------------------------------------
    private debitEventKeyFromAsaas(paymentIdAsaas: string) {
        return `CASHBACK:DEBIT:ASAAS:${paymentIdAsaas}`;
    }

    private earnEventKeyFromAsaas(paymentIdAsaas: string) {
        return `CASHBACK:EARN:ASAAS:${paymentIdAsaas}`;
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
        const amountToDebit = CashbackPolicy.normalizeMoney(params.amount);
        if (amountToDebit <= 0) return;

        const eventKey = this.debitEventKeyFromAsaas(params.paymentIdAsaas);

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

            if (existingTx) return;

            const now = new Date();

            const userTxs = await tx.cashbackTransaction.findMany({
                where: { userId: params.userId },
                select: {
                    type: true,
                    amount: true,
                    expiresAt: true,
                },
            });

            const balance = CashbackPolicy.computeBalance(
                userTxs.map((t) => ({
                    type: t.type,
                    amount: t.amount,
                    expiresAt: t.expiresAt,
                    eventKey: null,
                })),
                now,
            );

            const walletBalance = Number(wallet.balance ?? 0);

            if (balance.availableBalance < amountToDebit) {
                throw new AppError(
                    "Saldo de cashback insuficiente (saldo disponível real) para debitar no pagamento confirmado",
                    409,
                );
            }

            if (walletBalance < amountToDebit) {
                throw new AppError("Saldo de wallet insuficiente para debitar no pagamento confirmado", 409);
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

    /**
     * Crédito idempotente de cashback (EARNED) no PAID:
     * - Incrementa wallet INTERNAL
     * - Cria CashbackTransaction.EARNED com expiresAt opcional
     * - Usa eventKey único por paymentIdAsaas
     */
    public async creditCashbackEarnedIdempotentOnPaid(params: {
        userId: number;
        amount: number;
        paymentIdAsaas: string;
        paymentIdLocal?: number | null;
        source: TransactionSource;
        expiresAt?: Date | null;
        meta?: Record<string, any>;
    }): Promise<void> {
        const amountToCredit = CashbackPolicy.normalizeMoney(params.amount);
        if (amountToCredit <= 0) return;

        const eventKey = this.earnEventKeyFromAsaas(params.paymentIdAsaas);

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
                },
            });

            const existingTx = await tx.cashbackTransaction.findUnique({
                where: { eventKey },
                select: { id: true },
            });

            if (existingTx) return;

            await tx.cashbackWallet.update({
                where: { id: wallet.id },
                data: {
                    balance: {
                        increment: amountToCredit,
                    },
                },
            });

            await tx.cashbackTransaction.create({
                data: {
                    userId: params.userId,
                    type: TransactionType.EARNED,
                    source: params.source,
                    amount: amountToCredit,
                    relatedId: params.paymentIdAsaas,
                    eventKey,
                    meta: {
                        paymentIdLocal: params.paymentIdLocal ?? null,
                        paymentIdAsaas: params.paymentIdAsaas,
                        ...(params.meta ?? {}),
                    },
                    expiresAt: params.expiresAt ?? null,
                },
            });
        });
    }

    /**
     * Rebuild do saldo da wallet INTERNAL a partir das transações:
     * - balance = SUM(EARNED não expirado) - SUM(USED)
     */
    public async rebuildInternalWalletBalanceFromTransactions(params: {
        userId: number;
        now?: Date;
    }): Promise<{ walletId: number; newBalance: number }> {
        const now = params.now ?? new Date();

        return await prisma.$transaction(async (tx) => {
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
                },
            });

            const rows = await tx.cashbackTransaction.findMany({
                where: { userId: params.userId },
                select: {
                    type: true,
                    amount: true,
                    expiresAt: true,
                },
            });

            const balance = CashbackPolicy.computeBalance(
                rows.map((r) => ({
                    type: r.type,
                    amount: r.amount,
                    expiresAt: r.expiresAt,
                    eventKey: null,
                })),
                now,
            );

            await tx.cashbackWallet.update({
                where: { id: wallet.id },
                data: { balance: balance.availableBalance },
            });

            return { walletId: wallet.id, newBalance: balance.availableBalance };
        });
    }
}
