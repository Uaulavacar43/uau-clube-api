import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { LoginUserDTO } from "./dto/LoginUserDTO";
import { RegisterUserDTO } from "./dto/RegisterUserDTO";
import { authController } from "./index";

const router = Router();

router.post(
	"/register",
	validateRoutePayload(RegisterUserDTO),
	(req, res, next) => authController.register(req, res, next),
);

router.post(
	"/login",
	validateRoutePayload(LoginUserDTO),
	(req, res, next) => authController.login(req, res, next),
);

//router.get(
//	"/firebase-token/:id",
//	authMiddleware,
//	(req, res, next) => authController.getFirebaseToken(req, res, next),
//);

router.post(
	"/refresh-token",
	(req, res, next) => authController.refreshToken(req, res, next),
);

/**
 * ✅ GET /auth/referral-link
 * 🔗 Retorna o link de indicação do usuário logado
 *
 * Importante:
 * - Precisa do authMiddleware para popular req.user
 * - Se não tiver token → 401 "No token provided"
 */
router.get(
	"/referral-link",
	authMiddleware,
	(req, res, next) => authController.getReferralLink(req, res, next),
);

export default router;
