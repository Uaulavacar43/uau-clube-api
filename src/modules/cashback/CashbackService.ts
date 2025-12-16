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
}
