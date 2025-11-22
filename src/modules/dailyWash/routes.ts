import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { PrismaDailyWashRepository } from "../../repositories/implementations/PrismaDailyWashRepository";
import { PrismaIndividualServicePurchaseRepository } from "../../repositories/implementations/PrismaIndividualServicePurchaseRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { PrismaWashLocationRepository } from "../../repositories/implementations/PrismaWashLocationRepository";
import { DailyWashController } from "./DailyWashController";
import { DailyWashService } from "./DailyWashService";
import { CheckDailyWashAvailabilitySchema } from "./dto/CheckDailyWashAvailabilityDTO";
import { RegisterDailyWashSchema } from "./dto/RegisterDailyWashDTO";

const dailyWashRepository = new PrismaDailyWashRepository();
const userCarRepository = new PrismaUserCarRepository();
const individualPurchaseRepo = new PrismaIndividualServicePurchaseRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const washLocationRepository = new PrismaWashLocationRepository();

const dailyWashService = new DailyWashService(
	dailyWashRepository,
	userCarRepository,
	individualPurchaseRepo,
	subscriptionRepository,
	washLocationRepository,
);
const dailyWashController = new DailyWashController(dailyWashService);

const router = Router();

router.post(
	"/use",
	authMiddleware,
	validateRoutePayload(RegisterDailyWashSchema),
	(req, res, next) => dailyWashController.useDailyWash(req, res, next),
);

router.get(
	"/availability",
	authMiddleware,
	validateRoutePayload(CheckDailyWashAvailabilitySchema),
	(req, res, next) => dailyWashController.checkAvailability(req, res, next),
);

router.get(
	"/user/:userId/history",
	authMiddleware,
	(req, res, next) => dailyWashController.getUserWashHistory(req, res, next),
);

export default router;
