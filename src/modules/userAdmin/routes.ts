import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import validateRoutePayload from "../../middlewares/validateRoutePayload";

import { PrismaIndividualServicePurchaseRepository } from "../../repositories/implementations/PrismaIndividualServicePurchaseRepository";
import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";

import { CreateUserDTO } from "./dto/CreateUserDTO";
import { DeleteUserDTO } from "./dto/DeleteUserDTO";
import { GetAllUsersDTO } from "./dto/GetAllUsersDTO";
import { UpdateIndividualServicePurchaseDTO } from "./dto/UpdateIndividualServicePurchaseDTO";
import { UpdateUserDTO } from "./dto/UpdateUserDTO";



import { UserAdminController } from "./UserAdminController";
import { UserService } from "./UserAdminService";

import { AdminCarController } from "../adminCar/AdminCarController";
import { AdminCarService } from "../adminCar/AdminCarService";
import {AdminUpdateCarDTO} from "../adminCar/dto/AdminUpdateCarDTO";

const router = Router();

// -----------------------------------------------------------------------------
// Repositories
// -----------------------------------------------------------------------------
const userRepository = new PrismaUserRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const individualServicePurchaseRepository =
	new PrismaIndividualServicePurchaseRepository();

const userCarRepository = new PrismaUserCarRepository();

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------
const userAdminService = new UserService(
	userRepository,
	subscriptionRepository,
	individualServicePurchaseRepository,
);

// PaymentService opcional aqui
const adminCarService = new AdminCarService(
	userCarRepository,
	subscriptionRepository,
	undefined,
);

// -----------------------------------------------------------------------------
// Controllers
// -----------------------------------------------------------------------------
const userAdminController = new UserAdminController(userAdminService);
const adminCarController = new AdminCarController(adminCarService);

// -----------------------------------------------------------------------------
// MÉTRICAS (antes do "/:id" para evitar conflito)
// -----------------------------------------------------------------------------
router.get("/count/all", authMiddleware, (req, res, next) => {
	void userAdminController.countAllUsers(req, res, next);
});

router.get("/count/active-subscribers", authMiddleware, (req, res, next) => {
	void userAdminController.countActiveSubscribers(req, res, next);
});

// -----------------------------------------------------------------------------
// ADMIN: CARROS (NOVO)
// -----------------------------------------------------------------------------
router.get(
	"/cars/license-plate/:licensePlate",
	authMiddleware,
	(req, res, next) => {
		void adminCarController.getCarByPlate(req, res, next);
	},
);

router.patch(
	"/cars/:id",
	authMiddleware,
	validateRoutePayload(AdminUpdateCarDTO),
	(req, res, next) => {
		void adminCarController.updateCar(req, res, next);
	},
);

// -----------------------------------------------------------------------------
// USERS ADMIN (existente)
// -----------------------------------------------------------------------------
router.post(
	"/",
	authMiddleware,
	validateRoutePayload(CreateUserDTO),
	(req, res, next) => {
		void userAdminController.createUser(req, res, next);
	},
);

router.put(
	"/:id",
	authMiddleware,
	validateRoutePayload(UpdateUserDTO),
	(req, res, next) => {
		void userAdminController.updateUser(req, res, next);
	},
);

router.delete(
	"/:id",
	authMiddleware,
	validateRoutePayload(DeleteUserDTO),
	(req, res, next) => {
		void userAdminController.deleteUser(req, res, next);
	},
);

router.patch(
	"/individual-service-purchase/:id",
	authMiddleware,
	validateRoutePayload(UpdateIndividualServicePurchaseDTO),
	(req, res, next) => {
		void userAdminController.updateIndividualServicePurchase(req, res, next);
	},
);

// -----------------------------------------------------------------------------
// BUSCAS / LISTAGENS (sempre antes do "/:id")
// -----------------------------------------------------------------------------
router.get("/license-plate/:licensePlate", authMiddleware, (req, res, next) => {
	void userAdminController.getUserByLicensePlate(req, res, next);
});

router.get("/role/:role", authMiddleware, (req, res, next) => {
	void userAdminController.getUsersByRole(req, res, next);
});

router.get(
	"/",
	authMiddleware,
	validateRoutePayload(GetAllUsersDTO),
	(req, res, next) => {
		void userAdminController.getAllUsers(req, res, next);
	},
);

// POR ÚLTIMO
router.get("/:id", authMiddleware, (req, res, next) => {
	void userAdminController.getUserById(req, res, next);
});

export default router;
