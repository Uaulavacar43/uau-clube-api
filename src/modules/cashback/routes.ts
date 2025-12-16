import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { cashbackController } from "./index";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

/**
 * Rotas de Cashback (FASE 3)
 * Todas protegidas por auth
 */

router.get(
    "/wallet",
    authMiddleware,
    asyncHandler((req, res, next) =>
        cashbackController.getMyWallet(req, res, next),
    ),
);

router.get(
    "/transactions",
    authMiddleware,
    asyncHandler((req, res, next) =>
        cashbackController.getMyTransactions(req, res, next),
    ),
);

export default router;
