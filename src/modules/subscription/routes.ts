import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { MailingQueue } from "../../queues/MailingQueue";
import { PrismaPlanRepository } from "../../repositories/implementations/PrismaPlanRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { UpdateSubscriptionSchema } from "./dto/UpdateSubscriptionDTO";
import { SubscriptionController } from "./SubscriptionController";
import { SubscriptionService } from "./SubscriptionService";

const subscriptionRepository = new PrismaSubscriptionRepository();
const userRepository = new PrismaUserRepository();
const carRepository = new PrismaUserCarRepository();
const planRepository = new PrismaPlanRepository();
const mailingQueue = new MailingQueue();

const subscriptionService = new SubscriptionService(
	subscriptionRepository,
	carRepository,
	planRepository,
	userRepository,
	mailingQueue,
);
const subscriptionController = new SubscriptionController(subscriptionService);

const router = Router();

// router.post(
// 	'/',
// 	authMiddleware,
// 	validateRoutePayload(RegisterSubscriptionSchema),
// 	(req, res, next) => subscriptionController.registerSubscription(req, res, next)
// );

router.get("/", authMiddleware, (req, res, next) =>
	subscriptionController.listSubscriptions(req, res, next),
);

router.patch(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateSubscriptionSchema),
	(req, res, next) => subscriptionController.updateSubscription(req, res, next),
);

router.delete("/:id", authMiddleware, (req, res, next) =>
	subscriptionController.cancelSubscription(req, res, next),
);

router.post("/:id/activate", authMiddleware, (req, res, next) =>
	subscriptionController.activateSubscription(req, res, next),
);

router.post("/create", authMiddleware, (req, res, next) =>
	subscriptionController.createSubscription(req, res, next),
);

export default router;
