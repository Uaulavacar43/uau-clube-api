import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { asyncHandler } from "../../utils/asyncHandler";
import { CreateWashServiceDTO } from "./dto/CreateWashServiceDTO";
import { ListServicesWithLocationsDTO } from "./dto/ListServicesWithLocationsDTO";
import { ListTopSoldServicesDTO } from "./dto/ListTopSoldServicesDTO";
import { UpdateWashServiceDTO } from "./dto/UpdateWashServiceDTO";
import { washServiceController } from "./index";

const router = Router();

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreateWashServiceDTO),
	asyncHandler(async (req, res, next) => {
		await washServiceController.createWashService(req, res, next);
	}),
);

router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateWashServiceDTO),
	asyncHandler(async (req, res, next) => {
		await washServiceController.updateWashService(req, res, next);
	}),
);

router.delete(
	"/:id",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washServiceController.deleteWashService(req, res, next);
	}),
);

router.get(
	"/",
	authMiddleware,
	validateRoutePayload(ListServicesWithLocationsDTO),
	asyncHandler(async (req, res, next) => {
		await washServiceController.listServicesWithLocations(req, res, next);
	}),
);

router.get(
	"/top-sold",
	authMiddleware,
	validateRoutePayload(ListTopSoldServicesDTO),
	asyncHandler(async (req, res, next) => {
		await washServiceController.listTopSoldServices(req, res, next);
	}),
);

router.get(
	"/:id",
	asyncHandler(async (req, res, next) => {
		await washServiceController.getServiceById(req, res, next);
	}),
);

export default router;
