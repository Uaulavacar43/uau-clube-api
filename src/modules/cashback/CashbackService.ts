// src/modules/cashback/services/CashbackService.ts

import { AppError } from "../../error/AppError";
import { TransactionSource, TransactionType } from "@prisma/client";

import type { ReferralBonus } from "../../entities/ReferralBonus";
import type { CashbackTransaction } from "../../entities/CashbackTransaction";

import type { ICashbackWalletRepository } from "../../repositories/interfaces/ICashbackWalletRepository";
import type {
    ICashbackTransactionRepository,
    CashbackTransactionCreateInput,
} from "../../repositories/interfaces/ICashbackTransactionRepository";

import { CashbackBalanceDTO } from "./dto/CashbackBalanceDTO";
import { ListCashbackTransactionsDTO } from "./dto/ListCashbackTransactionsDTO";
import { CreditCashbackDTO } from "./dto/CreditCashbackDTO";
import { DebitCashbackDTO } from "./dto/DebitCashbackDTO";

// ajuste o caminho conforme tua estrutura (vc disse: está na pasta cashback)
import { CashbackPolicy, type TxLike } from "./CashbackPolicy";

export class CashbackService {
    constructor(
        private readonly walletRepo: ICashbackWalletRepository,
        private readonly txRepo: ICashbackTransactionRepository,
    ) {}

    // ------------------------------------------------------------------
    // EVENT KEYS PADRÃO
    // ------------------------------------------------------------------

    /**
     * ✅ padrão para débito usando paymentId LOCAL (quando o fluxo é interno).
     * (no webhook ASAAS o ideal é outro eventKey baseado em paymentIdAsaas)
     */
    private debitEventKeyFromLocalPayment(paymentId: number, userId: number) {
        return `CASHBACK:DEBIT:PAYMENT:${paymentId}:USER:${userId}`;
    }

    private welcomeEventKey(userId: number) {
        return `CASHBACK:WELCOME:USER:${userId}`;
    }

    // ------------------------------------------------------------------
    // BALANCE (fonte: CashbackPolicy)
    // ------------------------------------------------------------------
    private async computeBalance(
        userId: number,
        now: Date,
    ): Promise<{
        earnedValid: number;
        earnedExpired: number;
        usedTotal: number;
        availableBalance: number;
        all: CashbackTransaction[];
    }> {
        const all = await this.txRepo.findByUserId(userId);

        const txs: TxLike[] = all.map((t) => ({
            type: t.type,
            amount: (t as any)?.amount,
            expiresAt: (t as any)?.expiresAt,
            eventKey: (t as any)?.eventKey ?? null,
        }));

        const balance = CashbackPolicy.computeBalance(txs, now);

        return {
            ...balance,
            all,
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

        const amount = CashbackPolicy.normalizeMoney((bonus as any)?.amount);
        if (amount <= 0) {
            throw new AppError("ReferralBonus com amount inválido.", 400);
        }

        const exists = await this.txRepo.existsByEventKey(bonus.eventKey);
        if (exists) return;

        const wallet = await this.walletRepo.getOrCreateInternalWallet(bonus.receiverId);

        const createInput: CashbackTransactionCreateInput = {
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
        };

        await this.txRepo.create(createInput);
        await this.walletRepo.incrementBalance(wallet.id, amount);
    }

    // ------------------------------------------------------------------
    // Welcome bonus (expira em 7 dias por padrão)
    // ------------------------------------------------------------------
    public async creditWelcomeBonus(params: {
        userId: number;
        amount: number;
        validDays?: number;
    }): Promise<void> {
        const userId = Number(params.userId);
        if (!Number.isFinite(userId) || userId <= 0) {
            throw new AppError("userId inválido para welcome bonus.", 400);
        }

        const amount = CashbackPolicy.normalizeMoney(params.amount);
        if (amount <= 0) {
            throw new AppError("Welcome bonus inválido.", 400);
        }

        const validDays = params.validDays ?? 7;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

        const eventKey = this.welcomeEventKey(userId);

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
            amount: CashbackPolicy.normalizeMoney(dto.amount),
            relatedId: dto.relatedId,
            eventKey: dto.eventKey,
            meta: dto.meta ?? null,
            expiresAt: dto.expiresAt ?? null,
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
                return !CashbackPolicy.isExpired((tx as any)?.expiresAt, now);
            });

        return ListCashbackTransactionsDTO.from({
            transactions: filtered,
            now,
            includeExpired,
        });
    }

    // ------------------------------------------------------------------
    // Resolve uso no CREATE (mínimo + 50% + pós cupom) ✅ (sem débito)
    // ------------------------------------------------------------------
    public async resolveUsageForCharge(params: {
        userId: number;
        requestedCashback: number;
        amountAfterCoupon: number;
        minimumCharge: number;
    }): Promise<{
        cashbackUsed: number;
        amountAfterCashback: number;
        wallet: { id: number; balance: number };
        availableBalance: number;
    }> {
        const userId = Number(params.userId);
        if (!Number.isFinite(userId) || userId <= 0) {
            throw new AppError("userId inválido para cálculo de cashback.", 400);
        }

        const requested = CashbackPolicy.normalizeMoney(params.requestedCashback);
        const minimumCharge = Math.max(0, Number(params.minimumCharge ?? 0));
        const amountAfterCouponRaw = Math.max(0, Number(params.amountAfterCoupon ?? 0));

        if (requested <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCouponRaw,
                wallet: { id: 0, balance: 0 },
                availableBalance: 0,
            };
        }

        const wallet = await this.walletRepo.getOrCreateInternalWallet(userId);

        const now = new Date();
        const { availableBalance } = await this.computeBalance(userId, now);

        if (availableBalance <= 0) {
            throw new AppError("Saldo de cashback indisponível", 400);
        }

        // garante que a base do cálculo respeita o mínimo
        const amountAfterCoupon = Math.max(amountAfterCouponRaw, minimumCharge);

        // Regra 1: não pode reduzir abaixo do mínimo
        const maxByMinCharge = Math.max(0, amountAfterCoupon - minimumCharge);

        // Regra 2: até 50% do total pós cupom
        const maxByRule50 = Math.max(0, amountAfterCoupon * 0.5);

        const maxAllowed = Math.min(maxByMinCharge, maxByRule50);

        if (maxAllowed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: Number((wallet as any)?.balance ?? 0) },
                availableBalance,
            };
        }

        const cashbackUsed = Number(Math.min(availableBalance, requested, maxAllowed).toFixed(2));

        if (cashbackUsed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: Number((wallet as any)?.balance ?? 0) },
                availableBalance,
            };
        }

        const amountAfterCashback = Math.max(
            minimumCharge,
            Number((amountAfterCoupon - cashbackUsed).toFixed(2)),
        );

        return {
            cashbackUsed,
            amountAfterCashback,
            wallet: { id: wallet.id, balance: Number((wallet as any)?.balance ?? 0) },
            availableBalance,
        };
    }

    // ------------------------------------------------------------------
    // Débito no PAID (idempotente pelo paymentId local) ✅
    // Regra aqui: APENAS até 50% por uso (sem regra de mínimo)
    // ------------------------------------------------------------------
    public async debitForPayment(dto: DebitCashbackDTO): Promise<number> {
        const userId = Number((dto as any)?.userId);
        const paymentId = Number((dto as any)?.paymentId);

        const requestedAmount = CashbackPolicy.normalizeMoney((dto as any)?.requestedAmount);
        const paymentTotal = CashbackPolicy.normalizeMoney((dto as any)?.paymentTotal);

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

        const wallet = await this.walletRepo.getOrCreateInternalWallet(userId);

        const now = new Date();
        const { availableBalance } = await this.computeBalance(userId, now);

        const maxAllowedByRule50 = Number((paymentTotal * 0.5).toFixed(2));
        const allowed = Number(
            Math.min(requestedAmount, availableBalance, maxAllowedByRule50).toFixed(2),
        );

        if (allowed <= 0) return 0;

        const eventKey = this.debitEventKeyFromLocalPayment(paymentId, userId);

        // ✅ idempotência perfeita: retorna o amount REAL já registrado
        const existing = await this.txRepo.findByEventKey(eventKey);
        if (existing) {
            return CashbackPolicy.normalizeMoney((existing as any)?.amount);
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
                allowedByRule50: maxAllowedByRule50,
                availableBalanceBefore: availableBalance,
            },
            expiresAt: null,
        });

        await this.walletRepo.decrementBalance(wallet.id, allowed);

        return allowed;
    }
}
