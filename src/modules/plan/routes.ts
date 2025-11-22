import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { PrismaPlanRepository } from "../../repositories/implementations/PrismaPlanRepository";
import { asyncHandler } from "../../utils/asyncHandler";
import { CreatePlanSchema } from "./dto/CreatePlanDTO";
import { UpdatePlanSchema } from "./dto/UpdatePlanDTO";
import { PlanController } from "./PlanController";
import { PlanService } from "./PlanService";

const router = Router();
const planRepository = new PrismaPlanRepository();
const planService = new PlanService(planRepository);
const planController = new PlanController(planService);

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreatePlanSchema),
	asyncHandler(async (req, res, next) => {
		await planController.create(req, res, next);
	}),
);

router.get(
	"/",
	asyncHandler(async (req, res, next) => {
		await planController.findAll(req, res, next);
	}),
);

router.get(
	"/:id",
	asyncHandler(async (req, res, next) => {
		await planController.findById(req, res, next);
	}),
);

router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdatePlanSchema),
	asyncHandler(async (req, res, next) => {
		await planController.update(req, res, next);
	}),
);

router.delete(
	"/:id",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await planController.delete(req, res, next);
	}),
);

export default router;
