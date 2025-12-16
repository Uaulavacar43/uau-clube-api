import { AppError } from "../../error/AppError";
import { TransactionSource, TransactionType } from "@prisma/client";
import type { ReferralBonus } from "../../entities/ReferralBonus";
import type { ICashbackWalletRepository } from "../../repositories/interfaces/ICashbackWalletRepository";
import type { ICashbackTransactionRepository } from "../../repositories/interfaces/ICashbackTransactionRepository";

export class CashbackService {
    constructor(
        private readonly walletRepo: ICashbackWalletRepository,
        private readonly txRepo: ICashbackTransactionRepository,
    ) {}

    // ------------------------------------------------------------------
    // FASE 3 — Crédito automático por indicação
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

        const wallet = await this.walletRepo.getOrCreateInternalWallet(
            bonus.receiverId,
        );

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
        });

        await this.walletRepo.incrementBalance(wallet.id!, bonus.amount);
    }

    // ------------------------------------------------------------------
    // CONSULTAS
    // ------------------------------------------------------------------

    public async getWalletByUserId(userId: number) {
        return this.walletRepo.getByUserId(userId);
    }

    public async getTransactionsByUserId(userId: number) {
        return this.txRepo.findByUserId(userId);
    }
    public async debitForPayment(params: {
        userId: number;
        paymentId: number;
        amount: number;
    }): Promise<void> {
        const { userId, paymentId, amount } = params;

        if (amount <= 0) return;

        const wallet = await this.walletRepo.getByUserId(userId);
        if (!wallet) {
            throw new AppError("Carteira de cashback não encontrada.", 404);
        }

        if (wallet.balance < amount) {
            throw new AppError("Saldo de cashback insuficiente.", 400);
        }

        const eventKey = `DEBIT:PAYMENT:${paymentId}:USER:${userId}`;

        const alreadyUsed = await this.txRepo.existsByEventKey(eventKey);
        if (alreadyUsed) return;

        await this.txRepo.create({
            userId,
            type: "USED",
            source: "SUBSCRIPTION_DEBIT",
            amount,
            relatedId: String(paymentId),
            eventKey,
            meta: {
                paymentId,
                reason: "Pagamento com cashback",
            },
        });

        await this.walletRepo.decrementBalance(wallet.id, amount);
    }

}
