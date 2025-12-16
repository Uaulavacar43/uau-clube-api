import type { CashbackWallet } from "../../entities/CashbackWallet";

export interface ICashbackWalletRepository {
    getOrCreateInternalWallet(userId: number): Promise<CashbackWallet>;

    getByUserId(userId: number): Promise<CashbackWallet | null>;

    incrementBalance(walletId: number, amount: number): Promise<void>;

    decrementBalance(walletId: number, amount: number): Promise<void>;
}
