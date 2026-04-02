import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { welcomeBonusController } from ".";

const router = Router();

router.get("/", authMiddleware, (req, res, next) =>
	welcomeBonusController.getBonus(req, res, next),
);

export default router;
