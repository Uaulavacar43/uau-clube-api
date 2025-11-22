import { PrismaSubscriptionRepository } from "../../repositories/implementations/PrismaSubscriptionRepository";
import { PrismaUserCarRepository } from "../../repositories/implementations/PrismaUserCarRepository";
import userCarRoutes from "./routes";
import { UserCarController } from "./UserCarController";
import { UserCarService } from "./UserCarService";

const userCarRepository = new PrismaUserCarRepository();
const subscriptionRepository = new PrismaSubscriptionRepository();
const userCarService = new UserCarService(
	userCarRepository,
	subscriptionRepository,
);
const userCarController = new UserCarController(userCarService);

export { userCarController, userCarService, userCarRoutes };
