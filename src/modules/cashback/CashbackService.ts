import { AppError } from "../../error/AppError";
import { TransactionSource, TransactionType } from "@prisma/client";
import type { ReferralBonus } from "../../entities/ReferralBonus";
import type { CashbackTransaction } from "../../entities/CashbackTransaction";
import type { ICashbackWalletRepository } from "../../repositories/interfaces/ICashbackWalletRepository";
import type { ICashbackTransactionRepository } from "../../repositories/interfaces/ICashbackTransactionRepository";

import { CashbackBalanceDTO } from "./dto/CashbackBalanceDTO";
import { ListCashbackTransactionsDTO } from "./dto/ListCashbackTransactionsDTO";
import { CreditCashbackDTO } from "./dto/CreditCashbackDTO";
import { DebitCashbackDTO } from "./dto/DebitCashbackDTO";

export class CashbackService {
    constructor(
        private readonly walletRepo: ICashbackWalletRepository,
        private readonly txRepo: ICashbackTransactionRepository,
    ) {}

    // ------------------------------------------------------------------
    // HELPERS (regras centrais)
    // ------------------------------------------------------------------

    /**
     * Normaliza valores monetários vindos do Prisma/DTOs (number | string | Decimal).
     * - Garante number finito
     * - Arredonda para 2 casas
     * - Não permite negativos (cashback é sempre >= 0)
     */
    private normalizeMoney(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        if (n <= 0) return 0;
        return Number(n.toFixed(2));
    }

    private toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        const d = new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    private isExpired(tx: CashbackTransaction, now: Date): boolean {
        const expiresAt = this.toDate((tx as any)?.expiresAt);
        if (!expiresAt) return false;
        return expiresAt.getTime() <= now.getTime();
    }

    private async computeBalance(userId: number, now: Date): Promise<{
        earnedValid: number;
        earnedExpired: number;
        usedTotal: number;
        availableBalance: number;
        allTransactions: CashbackTransaction[];
    }> {
        const all = await this.txRepo.findByUserId(userId);

        let earnedValid = 0;
        let earnedExpired = 0;
        let usedTotal = 0;

        for (const tx of all) {
            const amount = this.normalizeMoney((tx as any)?.amount);

            if (tx.type === TransactionType.EARNED) {
                if (this.isExpired(tx, now)) earnedExpired += amount;
                else earnedValid += amount;
            }

            if (tx.type === TransactionType.USED) {
                usedTotal += amount;
            }
        }

        earnedValid = Number(earnedValid.toFixed(2));
        earnedExpired = Number(earnedExpired.toFixed(2));
        usedTotal = Number(usedTotal.toFixed(2));

        const rawAvailable = earnedValid - usedTotal;
        const availableBalance = rawAvailable < 0 ? 0 : Number(rawAvailable.toFixed(2));

        return {
            earnedValid,
            earnedExpired,
            usedTotal,
            availableBalance,
            allTransactions: all,
        };
    }

    // ------------------------------------------------------------------
    // Crédito por indicação (ReferralBonus -> Cashback)
    // ------------------------------------------------------------------

    public async creditFromReferralBonus(bonus: ReferralBonus): Promise<void> {
        if (bonus.paymentStatus !== "PAID") {
            throw new AppError("ReferralBonus não está PAID.", 400);
        }

        if (!bonus.eventKey) {
            throw new AppError("ReferralBonus sem eventKey.", 500);
        }

        const amount = this.normalizeMoney((bonus as any)?.amount);
        if (amount <= 0) {
            throw new AppError("ReferralBonus com amount inválido.", 400);
        }

        const exists = await this.txRepo.existsByEventKey(bonus.eventKey);
        if (exists) return;

        const wallet = await this.walletRepo.getOrCreateInternalWallet(bonus.receiverId);

        await this.txRepo.create({
            userId: bonus.receiverId,
            type: TransactionType.EARNED,
            source: TransactionSource.INDICATION,
            amount,
            relatedId: String(bonus.id),
            eventKey: bonus.eventKey,
            meta: {
                payerId: bonus.payerId,
                level: bonus.level,
                bonusType: bonus.type,
                competence: bonus.competenceYearMonth ?? null,
            },
            expiresAt: null,
        });

        await this.walletRepo.incrementBalance(wallet.id, amount);
    }

    // ------------------------------------------------------------------
    // Welcome bonus (expira em 7 dias)
    // ------------------------------------------------------------------

    public async creditWelcomeBonus(params: {
        userId: number;
        amount: number;
        validDays?: number;
    }): Promise<void> {
        const { userId } = params;

        const amount = this.normalizeMoney(params.amount);
        if (amount <= 0) {
            throw new AppError("Welcome bonus inválido.", 400);
        }

        const validDays = params.validDays ?? 7;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

        const eventKey = `WELCOME_BONUS:USER:${userId}`;

        const exists = await this.txRepo.existsByEventKey(eventKey);
        if (exists) return;

        const wallet = await this.walletRepo.getOrCreateInternalWallet(userId);

        const dto = new CreditCashbackDTO({
            userId,
            amount,
            source: TransactionSource.WELCOME_BONUS,
            eventKey,
            relatedId: null,
            meta: { rule: "WELCOME_BONUS", validDays },
            expiresAt,
        });

        await this.txRepo.create({
            userId: dto.userId,
            type: dto.type,
            source: dto.source,
            amount: this.normalizeMoney(dto.amount),
            relatedId: dto.relatedId,
            eventKey: dto.eventKey,
            meta: dto.meta, // undefined se não tiver
            expiresAt: dto.expiresAt,
        });

        await this.walletRepo.incrementBalance(wallet.id, amount);
    }

    // ------------------------------------------------------------------
    // Consultas
    // ------------------------------------------------------------------

    public async getBalanceByUserId(userId: number): Promise<CashbackBalanceDTO> {
        const now = new Date();
        const wallet = await this.walletRepo.getByUserId(userId);

        const { earnedValid, earnedExpired, usedTotal, availableBalance } =
            await this.computeBalance(userId, now);

        return CashbackBalanceDTO.from({
            userId,
            wallet,
            earnedValid,
            earnedExpired,
            usedTotal,
            availableBalance,
            now,
        });
    }

    public async getWalletByUserId(userId: number) {
        return this.walletRepo.getByUserId(userId);
    }

    public async getTransactionsByUserId(params: {
        userId: number;
        includeExpired?: boolean;
    }): Promise<ListCashbackTransactionsDTO> {
        const now = new Date();
        const includeExpired = params.includeExpired ?? true;

        const txs = await this.txRepo.findByUserId(params.userId);

        const filtered = includeExpired
            ? txs
            : txs.filter((tx) => {
                if (tx.type !== TransactionType.EARNED) return true;
                return !this.isExpired(tx, now);
            });

        return ListCashbackTransactionsDTO.from({
            transactions: filtered,
            now,
            includeExpired,
        });
    }

    // ------------------------------------------------------------------
    // Débito (regra 50% + expiração + idempotência)
    // ------------------------------------------------------------------

    public async debitForPayment(dto: DebitCashbackDTO): Promise<number> {
        const userId = Number((dto as any)?.userId);
        const paymentId = Number((dto as any)?.paymentId);

        const requestedAmount = this.normalizeMoney((dto as any)?.requestedAmount);
        const paymentTotal = this.normalizeMoney((dto as any)?.paymentTotal);

        if (!Number.isFinite(userId) || userId <= 0) {
            throw new AppError("userId inválido para débito de cashback.", 400);
        }

        if (!Number.isFinite(paymentId) || paymentId <= 0) {
            throw new AppError("paymentId inválido para débito de cashback.", 400);
        }

        if (requestedAmount <= 0) return 0;

        if (!paymentTotal || paymentTotal <= 0) {
            throw new AppError("paymentTotal inválido para aplicar regra de 50%.", 400);
        }

        const wallet = await this.walletRepo.getByUserId(userId);
        if (!wallet) throw new AppError("Carteira de cashback não encontrada.", 404);

        const now = new Date();
        const { availableBalance, allTransactions } = await this.computeBalance(userId, now);

        const maxAllowed = Number((paymentTotal * 0.5).toFixed(2));
        const allowed = Number(
            Math.min(requestedAmount, availableBalance, maxAllowed).toFixed(2),
        );

        if (allowed <= 0) return 0;

        const eventKey = `DEBIT:PAYMENT:${paymentId}:USER:${userId}`;

        const alreadyUsed = await this.txRepo.existsByEventKey(eventKey);
        if (alreadyUsed) {
            const existing = allTransactions.find((t) => t.eventKey === eventKey);
            return this.normalizeMoney((existing as any)?.amount);
        }

        await this.txRepo.create({
            userId,
            type: TransactionType.USED,
            source: TransactionSource.SUBSCRIPTION_DEBIT,
            amount: allowed,
            relatedId: String(paymentId),
            eventKey,
            meta: {
                paymentId,
                reason: "Pagamento com cashback",
                requestedAmount,
                allowedByRule50: maxAllowed,
                availableBalanceBefore: availableBalance,
            },
            expiresAt: null,
        });

        await this.walletRepo.decrementBalance(wallet.id, allowed);

        return allowed;
    }
}
