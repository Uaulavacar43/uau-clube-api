import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { WelcomeBonusController } from "./WelcomeBonusController";
import { WelcomeBonusService } from "./WelcomeBonusService";
import welcomeBonusRoutes from "./routes";

const userRepository = new PrismaUserRepository();
const welcomeBonusService = new WelcomeBonusService(userRepository);
export const welcomeBonusController = new WelcomeBonusController(
	welcomeBonusService,
);

export { welcomeBonusService };
export default welcomeBonusRoutes;
