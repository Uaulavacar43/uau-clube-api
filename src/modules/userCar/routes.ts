import { Router, type Request, type Response, type NextFunction } from "express";
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
const userCarService = new UserCarService(userCarRepository, subscriptionRepository);
const userCarController = new UserCarController(userCarService);

const router = Router();

/**
 * Garante que o DTO que espera `id` receba o valor de `req.params.id`,
 * sem depender do frontend enviar `id` no body.
 */
function injectParamIdIntoBody(req: Request, _res: Response, next: NextFunction) {
	if (req.params?.id) {
		req.body = {
			...(req.body ?? {}),
			id: req.params.id,
		};
	}
	next();
}

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
	injectParamIdIntoBody,
	validateRoutePayload(UpdateUserCarDTO),
	asyncHandler(async (req, res, next) => {
		await userCarController.updateCar(req, res, next);
	}),
);

router.delete(
	"/:id",
	authMiddleware,
	injectParamIdIntoBody,
	validateRoutePayload(DeleteUserCarDTO),
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
