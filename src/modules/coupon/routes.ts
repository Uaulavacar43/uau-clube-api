import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { asyncHandler } from "../../utils/asyncHandler";
import { CreateCouponDTO } from "./dto/CreateCouponDTO";
import { UpdateCouponDTO } from "./dto/UpdateCouponDTO";
import { ValidateCouponDTO } from "./dto/ValidateCouponDTO";
import { couponController } from "./index";

const router = Router();

// Rotas protegidas (requerem autenticação)
router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreateCouponDTO),
	asyncHandler(async (req, res, next) => {
		await couponController.createCoupon(req, res, next);
	}),
);

router.get(
	"/",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await couponController.listCoupons(req, res, next);
	}),
);

router.get(
	"/:id",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await couponController.getCouponById(req, res, next);
	}),
);

router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateCouponDTO),
	asyncHandler(async (req, res, next) => {
		await couponController.updateCoupon(req, res, next);
	}),
);

router.delete(
	"/:id",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await couponController.deleteCoupon(req, res, next);
	}),
);

// Rotas públicas (não requerem autenticação)
router.get(
	"/validate/:code",
	validateRoutePayload(ValidateCouponDTO),
	asyncHandler(async (req, res, next) => {
		await couponController.validateCoupon(req, res, next);
	}),
);

router.post(
	"/use/:code",
	authMiddleware,
	asyncHandler(async (req, res, next) => {
		await couponController.useCoupon(req, res, next);
	}),
);

export default router;
