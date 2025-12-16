import { Router } from "express";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidateReferralDTO } from "./dto/ValidateReferralDTO";
import { referralsController } from "./index";

const router = Router();

/**
 * Rotas públicas (FASE 1)
 * POST /referrals/validate
 */
router.post(
    "/validate",
    validateRoutePayload(ValidateReferralDTO),
    asyncHandler(async (req, res, next) => {
        await referralsController.validateReferral(req, res, next);
    }),
);

export default router;
