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

    private isExpired(tx: CashbackTransaction, now: Date): boolean {
        if (!tx.expiresAt) return false;
        return tx.expiresAt.getTime() <= now.getTime();
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
            if (tx.type === TransactionType.EARNED) {
                if (this.isExpired(tx, now)) earnedExpired += tx.amount;
                else earnedValid += tx.amount;
            }

            if (tx.type === TransactionType.USED) {
                usedTotal += tx.amount;
            }
        }

        const rawAvailable = earnedValid - usedTotal;
        const availableBalance = rawAvailable < 0 ? 0 : rawAvailable;

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

        const exists = await this.txRepo.existsByEventKey(bonus.eventKey);
        if (exists) return;

        const wallet = await this.walletRepo.getOrCreateInternalWallet(bonus.receiverId);

        await this.txRepo.create({
            userId: bonus.receiverId,
            type: TransactionType.EARNED,
            source: TransactionSource.INDICATION,
            amount: bonus.amount,
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

        await this.walletRepo.incrementBalance(wallet.id, bonus.amount);
    }

    // ------------------------------------------------------------------
    // Welcome bonus (expira em 7 dias)
    // ------------------------------------------------------------------

    public async creditWelcomeBonus(params: {
        userId: number;
        amount: number;
        validDays?: number;
    }): Promise<void> {
        const { userId, amount } = params;

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
            amount: dto.amount,
            relatedId: dto.relatedId,
            eventKey: dto.eventKey,
            meta: dto.meta,              // undefined se não tiver
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
        const { userId, paymentId, requestedAmount, paymentTotal } = dto;

        if (requestedAmount <= 0) return 0;

        if (!paymentTotal || paymentTotal <= 0) {
            throw new AppError("paymentTotal inválido para aplicar regra de 50%.", 400);
        }

        const wallet = await this.walletRepo.getByUserId(userId);
        if (!wallet) throw new AppError("Carteira de cashback não encontrada.", 404);

        const now = new Date();
        const { availableBalance, allTransactions } = await this.computeBalance(userId, now);

        const maxAllowed = paymentTotal * 0.5;
        const allowed = Math.min(requestedAmount, availableBalance, maxAllowed);

        if (allowed <= 0) return 0;

        const eventKey = `DEBIT:PAYMENT:${paymentId}:USER:${userId}`;

        const alreadyUsed = await this.txRepo.existsByEventKey(eventKey);
        if (alreadyUsed) {
            const existing = allTransactions.find((t) => t.eventKey === eventKey);
            return existing?.amount ?? 0;
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
