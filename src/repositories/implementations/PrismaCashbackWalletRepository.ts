import { CashbackWallet } from "../../entities/CashbackWallet";
import type { ICashbackWalletRepository } from "../interfaces/ICashbackWalletRepository";
import prisma from "../../config/dbConfig";
import { WalletType } from "@prisma/client";

export class PrismaCashbackWalletRepository implements ICashbackWalletRepository {
    private readonly INTERNAL_TYPE: WalletType = WalletType.INTERNAL;

    async getOrCreateInternalWallet(userId: number): Promise<CashbackWallet> {
        const wallet = await prisma.cashbackWallet.upsert({
            where: {
                userId_type: {
                    userId,
                    type: this.INTERNAL_TYPE,
                },
            },
            create: {
                userId,
                type: this.INTERNAL_TYPE,
                balance: 0,
            },
            update: {},
        });

        return new CashbackWallet(wallet);
    }

    async getByUserId(userId: number): Promise<CashbackWallet | null> {
        const wallet = await prisma.cashbackWallet.findUnique({
            where: {
                userId_type: {
                    userId,
                    type: this.INTERNAL_TYPE,
                },
            },
        });

        return wallet ? new CashbackWallet(wallet) : null;
    }

    async incrementBalance(walletId: number, amount: number): Promise<void> {
        if (amount <= 0) return;

        await prisma.cashbackWallet.update({
            where: { id: walletId },
            data: { balance: { increment: amount } },
        });
    }

    async decrementBalance(walletId: number, amount: number): Promise<void> {
        if (amount <= 0) return;

        await prisma.cashbackWallet.update({
            where: { id: walletId },
            data: { balance: { decrement: amount } },
        });
    }
}
