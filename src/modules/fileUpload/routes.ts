import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { asyncHandler } from "../../utils/asyncHandler";
import { FileUploadDTO } from "./dto/FileUploadDTO";
import { fileUploadController } from "./index";

const router = Router();

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(FileUploadDTO),
	asyncHandler(async (req, res, next) => {
		await fileUploadController.generateFileUrl(req, res, next);
	}),
);

export default router;
