import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { MailingQueue } from "../../queues/MailingQueue";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { UpdateUserPasswordDTO } from "./dto/UpdateUserPasswordDTO";
import { UpdateUserProfileDTO } from "./dto/UpdateUserProfileDTO";
import { UserProfileController } from "./UserProfileController";
import { UserProfileService } from "./UserProfileService";

const userRepository = new PrismaUserRepository();
const mailingQueue = new MailingQueue();
const userProfileService = new UserProfileService(userRepository, mailingQueue);
const userProfileController = new UserProfileController(userProfileService);

const router = Router();

// Ruta para actualizar el perfil del usuario con Multer para la imagen
router.put(
	"/profile/:id",
	authMiddleware,
	validateRoutePayload(UpdateUserProfileDTO),
	(req, res, next) => userProfileController.updateUserProfile(req, res, next),
);

// Ruta para actualizar la contraseña del usuario
router.put(
	"/password/:id",
	authMiddleware,
	validateRoutePayload(UpdateUserPasswordDTO),
	(req, res, next) => userProfileController.updatePassword(req, res, next),
);

router.post("/request-password-reset", (req, res, next) =>
	userProfileController.requestPasswordReset(req, res, next),
);
router.post("/reset-password", (req, res, next) =>
	userProfileController.resetPassword(req, res, next),
);

export default router;
