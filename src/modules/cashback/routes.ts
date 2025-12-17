import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { cashbackController } from "./index";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

/**
 * Rotas de Cashback (FASE 4)
 * Todas protegidas por auth
 *
 * GET /cashback/wallet
 * GET /cashback/transactions?includeExpired=true|false
 * GET /cashback/balance
 */

router.get(
    "/wallet",
    authMiddleware,
    asyncHandler((req, res, next) => cashbackController.getMyWallet(req, res, next)),
);

router.get(
    "/transactions",
    authMiddleware,
    asyncHandler((req, res, next) => cashbackController.getMyTransactions(req, res, next)),
);

/**
 * ✅ NOVO: saldo consolidado (aplica expiração do WELCOME_BONUS, soma earned/used, etc.)
 */
router.get(
    "/balance",
    authMiddleware,
    asyncHandler((req, res, next) => cashbackController.getMyBalance(req, res, next)),
);

export default router;
