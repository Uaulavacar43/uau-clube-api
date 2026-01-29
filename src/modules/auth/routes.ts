import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { MailingQueue } from "../../queues/MailingQueue";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { UserProfileController } from "../userProfile/UserProfileController";
import { UserProfileService } from "../userProfile/UserProfileService";
import { LoginUserDTO } from "./dto/LoginUserDTO";
import { RegisterUserDTO } from "./dto/RegisterUserDTO";
import { authController } from "./index";

const router = Router();

const userRepository = new PrismaUserRepository();
const mailingQueue = new MailingQueue();
const userProfileService = new UserProfileService(userRepository, mailingQueue);
const userProfileController = new UserProfileController(userProfileService);

router.post(
	"/register",
	validateRoutePayload(RegisterUserDTO),
	(req, res, next) => authController.register(req, res, next),
);
router.post("/login", validateRoutePayload(LoginUserDTO), (req, res, next) =>
	authController.login(req, res, next),
);

router.get("/firebase-token/:id", authMiddleware, (req, res, next) =>
	authController.getFirebaseToken(req, res, next),
);

router.post("/refresh-token", (req, res, next) =>
	authController.refreshToken(req, res, next),
);

router.post("/forgot-password", (req, res, next) =>
	userProfileController.requestPasswordReset(req, res, next),
);

router.post("/reset-password", (req, res, next) =>
	userProfileController.resetPassword(req, res, next),
);

export default router;
