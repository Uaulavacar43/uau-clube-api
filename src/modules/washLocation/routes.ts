import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { asyncHandler } from "../../utils/asyncHandler";
import { FavoriteWashLocationDTO } from "./dto/FavoriteWashLocationDTO";
import { GetAllWashLocationsDTO } from "./dto/GetAllWashLocationsDTO";
import { RegisterCompleteWashLocationDTO } from "./dto/RegisterCompleteWashLocationDTO";
import { RegisterWashLocationDTO } from "./dto/RegisterWashLocationDTO";
import { UpdateCompleteWashLocationDTO } from "./dto/UpdateCompleteWashLocationDTO";
import { UpdateOpeningHoursDTO } from "./dto/UpdateOpeningHoursDTO";
import { UpdateWashLocationDTO } from "./dto/UpdateWashLocationDTO";
import { washLocationController } from "./index";

const router = Router();

// Rotas POST
router.post(
	"/",
	authMiddleware,
	validateRoutePayload(RegisterWashLocationDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.registerWashLocation(req, res, next);
	}),
);
router.post(
	"/complete",
	authMiddleware,
	validateRoutePayload(RegisterCompleteWashLocationDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.registerCompleteWashLocation(req, res, next);
	}),
);
router.post(
	"/:locationId/favorite",
	authMiddleware,
	validateRoutePayload(FavoriteWashLocationDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.favoriteWashLocation(req, res, next);
	}),
);

// Rotas PUT
router.put(
	"/service-availability/:locationId/:serviceId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washLocationController.updateServiceAvailability(req, res, next);
	}),
);
router.put(
	"/flow/:locationId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washLocationController.updateFlow(req, res, next);
	}),
);
router.put(
	"/opening-hours/:locationId",
	authMiddleware,
	validateRoutePayload(UpdateOpeningHoursDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.updateOpeningHours(req, res, next);
	}),
);
router.put(
	"/:locationId",
	authMiddleware,
	validateRoutePayload(UpdateWashLocationDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.updateWashLocation(req, res, next);
	}),
);
router.put(
	"/complete/:locationId",
	authMiddleware,
	validateRoutePayload(UpdateCompleteWashLocationDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.updateCompleteWashLocation(req, res, next);
	}),
);

// Rotas GET
router.get(
	"/",
	authMiddleware,
	validateRoutePayload(GetAllWashLocationsDTO),
	asyncHandler(async (req, res, next) => {
		await washLocationController.listWashLocations(req, res, next);
	}),
);
router.get(
	"/by-manager/:managerId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washLocationController.listWashLocationsByManager(req, res, next);
	}),
);
router.get(
	"/detail/:locationId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washLocationController.getWashLocationDetail(req, res, next);
	}),
);

// Rotas DELETE
router.delete(
	"/:locationId",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await washLocationController.deleteWashLocation(req, res, next);
	}),
);

export default router;
