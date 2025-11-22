import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { SendNotificationDTO } from "./dto/SendNotificationDTO";
import { notificationController } from "./index";

const router = Router();

// Rutas para notificaciones
router.get("/list", authMiddleware, (req, res, next) =>
	notificationController.listNotifications(req, res, next),
);

router.post(
	"/send",
	authMiddleware,
	validateRoutePayload(SendNotificationDTO),
	(req, res, next) => notificationController.sendNotification(req, res, next),
);

router.post("/notify-payment-status", authMiddleware, (req, res, next) =>
	notificationController.notifyPaymentStatus(req, res, next),
);

router.post("/notify-upcoming-expiry", authMiddleware, (req, res, next) =>
	notificationController.notifyUpcomingSubscriptionExpiry(req, res, next),
);

router.post("/send-automatic", authMiddleware, (req, res, next) =>
	notificationController.sendAutomaticNotifications(req, res, next),
);

export default router;
