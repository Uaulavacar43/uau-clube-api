import type { CashbackTransaction } from "../../entities/CashbackTransaction";

export interface ICashbackTransactionRepository {
    create(
        data: Omit<CashbackTransaction, "id" | "createdAt">,
    ): Promise<CashbackTransaction>;

    existsByEventKey(eventKey: string): Promise<boolean>;

    findByUserId(userId: number): Promise<CashbackTransaction[]>;
}
