import { PrismaWashServiceRepository } from "../../repositories/implementations/PrismaWashServiceRepository";
import washServiceRoutes from "./routes";
import { WashServiceController } from "./WashController";
import { WashServiceService } from "./WashService";

const washServiceRepository = new PrismaWashServiceRepository();
const washService = new WashServiceService(washServiceRepository);
const washServiceController = new WashServiceController(washService);

export { washServiceController, washServiceRoutes, washService };
