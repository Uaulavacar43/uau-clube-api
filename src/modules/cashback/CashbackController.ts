import { Request, Response, NextFunction } from "express";
import { AppError } from "../../error/AppError";
import { CashbackService } from "./CashbackService";

export class CashbackController {
    constructor(private readonly cashbackService: CashbackService) {}

    /**
     * Retorna a carteira RAW (tabela CashbackWallet)
     * (mantém compatibilidade com implementações antigas)
     */
    public async getMyWallet(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = Number((req as any).user?.id);
            if (!userId) throw new AppError("Usuário não autenticado.", 401);

            const wallet = await this.cashbackService.getWalletByUserId(userId);
            return res.json(wallet);
        } catch (err) {
            next(err);
        }
    }

    /**
     * Retorna o saldo "real" (aplicando expiração e somatórios)
     * Recomendado para UI.
     */
    public async getMyBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = Number((req as any).user?.id);
            if (!userId) throw new AppError("Usuário não autenticado.", 401);

            const dto = await this.cashbackService.getBalanceByUserId(userId);
            return res.json(dto.toJSON());

        } catch (err) {
            next(err);
        }
    }

    /**
     * Retorna o extrato (transações) do usuário autenticado
     * Query:
     *  - includeExpired=true|false (default true)
     */
    public async getMyTransactions(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = Number((req as any).user?.id);
            if (!userId) throw new AppError("Usuário não autenticado.", 401);

            const includeExpiredRaw = (req.query.includeExpired as string | undefined) ?? "true";
            const includeExpired = includeExpiredRaw !== "false";

            const dto = await this.cashbackService.getTransactionsByUserId({
                userId,
                includeExpired,
            });

            return res.json(dto);
        } catch (err) {
            next(err);
        }
    }
}
