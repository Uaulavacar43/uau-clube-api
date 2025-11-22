import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import dashboardController from ".";

const router = Router();

router.get("/", authMiddleware, (req, res, next) => {
	return dashboardController.getDashboardData(req, res, next);
});

export default router;
