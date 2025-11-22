import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import { asyncHandler } from "../../utils/asyncHandler";
import { DeleteUserCarDTO } from "./dto/DeleteUserCarDTO";
import { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";
import { UserCarController } from "./UserCarController";
import { UserCarService } from "./UserCarService";

const userCarRepository = new PrismaUserCarRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const userCarService = new UserCarService(
	userCarRepository,
	subscriptionRepository,
);
const userCarController = new UserCarController(userCarService);

const router = Router();

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(RegisterUserCarDTO),
	asyncHandler(async (req, res, next) => {
		await userCarController.registerUserCar(req, res, next);
	}),
);

router.get(
	"/",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await userCarController.listCars(req, res, next);
	}),
);

router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateUserCarDTO),
	asyncHandler(async (req, res, next) => {
		await userCarController.updateCar(req, res, next);
	}),
);

router.delete(
	"/:id",
	validateRoutePayload(DeleteUserCarDTO),
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await userCarController.deleteCar(req, res, next);
	}),
);

router.get(
	"/user/:userId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await userCarController.listUserCars(req, res, next);
	}),
);

export default router;
