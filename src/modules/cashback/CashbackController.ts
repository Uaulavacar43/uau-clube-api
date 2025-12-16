import { Request, Response, NextFunction } from "express";
import { CashbackService } from "./CashbackService";

export class CashbackController {
    constructor(private readonly cashbackService: CashbackService) {}

    /**
     * Retorna a carteira do usuário autenticado
     */
    public async getMyWallet(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = Number((req as any).user?.id);
            const wallet = await this.cashbackService.getWalletByUserId(userId);
            return res.json(wallet);
        } catch (err) {
            next(err);
        }
    }

    /**
     * Retorna o extrato (transações) do usuário autenticado
     */
    public async getMyTransactions(
        req: Request,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const userId = Number((req as any).user?.id);
            const transactions =
                await this.cashbackService.getTransactionsByUserId(userId);
            return res.json(transactions);
        } catch (err) {
            next(err);
        }
    }
}
