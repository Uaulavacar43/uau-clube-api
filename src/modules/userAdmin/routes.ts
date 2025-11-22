import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";
import { PrismaIndividualServicePurchaseRepository } from "../../repositories/implementations/PrismaIndividualServicePurchaseRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { CreateUserDTO } from "./dto/CreateUserDTO";
import { DeleteUserDTO } from "./dto/DeleteUserDTO";
import { GetAllUsersDTO } from "./dto/GetAllUsersDTO";
import { UpdateIndividualServicePurchaseDTO } from "./dto/UpdateIndividualServicePurchaseDTO";
import { UpdateUserDTO } from "./dto/UpdateUserDTO";
import { UserAdminController } from "./UserAdminController";
import { UserService } from "./UserAdminService";

const userRepository = new PrismaUserRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const individualServicePurchaseRepository =
	new PrismaIndividualServicePurchaseRepository();
const userAdminService = new UserService(
	userRepository,
	subscriptionRepository,
	individualServicePurchaseRepository,
);
const userAdminController = new UserAdminController(userAdminService);

const router = Router();

router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreateUserDTO),
	(req, res, next) => userAdminController.createUser(req, res, next),
);
router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateUserDTO),
	(req, res, next) => userAdminController.updateUser(req, res, next),
);
router.delete(
	"/:id",
	authMiddleware,
	validateRoutePayload(DeleteUserDTO),
	(req, res, next) => userAdminController.deleteUser(req, res, next),
);

router.patch(
	"/individual-service-purchase/:id",
	authMiddleware,
	validateRoutePayload(UpdateIndividualServicePurchaseDTO),
	(req, res, next) =>
		userAdminController.updateIndividualServicePurchase(req, res, next),
);

router.get("/license-plate/:licensePlate", authMiddleware, (req, res, next) =>
	userAdminController.getUserByLicensePlate(req, res, next),
);
router.get("/:id", authMiddleware, (req, res, next) =>
	userAdminController.getUserById(req, res, next),
);
//router.get('/', authMiddleware, (req, res, next) => userAdminController.getAllUsers(req, res, next));
router.get("/role/:role", authMiddleware, (req, res, next) =>
	userAdminController.getUsersByRole(req, res, next),
);
router.get(
	"/",
	authMiddleware,
	validateRoutePayload(GetAllUsersDTO),
	(req, res, next) => userAdminController.getAllUsers(req, res, next),
);

// Métricas
router.get("/count/all", authMiddleware, (req, res, next) =>
	userAdminController.countAllUsers(req, res, next),
);
router.get("/count/active-subscribers", authMiddleware, (req, res, next) =>
	userAdminController.countActiveSubscribers(req, res, next),
);

export default router;
