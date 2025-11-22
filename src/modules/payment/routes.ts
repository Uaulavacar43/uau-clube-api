import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { paymentController } from ".";
import { CreatePaymentSchema } from "./dto/CreatePaymentDTO";
import { CreateSubscriptionToPlanSchema } from "./dto/CreateSubscriptionToPlanDTO";
import { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";
import { UpdatePaymentStatusSchema } from "./dto/UpdatePaymentStatusDTO";

const router = Router();

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreatePaymentSchema),
	(req, res, next) => paymentController.createPayment(req, res, next),
);
router.post(
	"/subscribe",
	authMiddleware,
	validateRoutePayload(CreateSubscriptionToPlanSchema),
	(req, res, next) => paymentController.subscribeToPlan(req, res, next),
);
router.post("/payments-webhook", (req, res, next) => {
	paymentController.paymentWebhook(req, res, next);
});

router.put(
	"/update-status",
	authMiddleware,
	validateRoutePayload(UpdatePaymentStatusSchema),
	(req, res, next) => paymentController.updatePaymentStatus(req, res, next),
);

/*router.get(
	"/history/monthly",
	authMiddleware, 
	(req, res, next) => paymentController.getMonthlyRevenueHistory(req, res, next)
);
*/
router.get("/history/yearly", authMiddleware, (req, res, next) =>
	paymentController.getYearlyRevenueHistory(req, res, next),
);

router.get("/all", authMiddleware, (req, res, next) =>
	paymentController.getAllPaymentsWithDetails(req, res, next),
);
router.get("/total-revenue", authMiddleware, (req, res, next) =>
	paymentController.getTotalRevenue(req, res, next),
);
router.get("/current-month-revenue", authMiddleware, (req, res, next) =>
	paymentController.getCurrentMonthRevenue(req, res, next),
);
router.get("/next-month-predicted-revenue", authMiddleware, (req, res, next) =>
	paymentController.getNextMonthPredictedRevenue(req, res, next),
);
router.get(
	"/detailed-payments",
	authMiddleware,
	validateRoutePayload(GetAllPaymentsWithDetailsDTO),
	(req, res, next) =>
		paymentController.getAllPaymentsWithDetails(req, res, next),
);
router.get("/detailed-payments/:id", authMiddleware, (req, res, next) =>
	paymentController.getPaymentDetailsById(req, res, next),
);
router.get("/mrr", authMiddleware, (req, res, next) =>
	paymentController.getMRR(req, res, next),
);
router.get("/detail/:id", authMiddleware, (req, res, next) =>
	paymentController.getPaymentDetailsById(req, res, next),
);

export default router;
