import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { PrismaWashLocationRepository } from "../../repositories/implementations/PrismaWashLocationRepository";
import washLocationRoutes from "./routes";
import { WashLocationController } from "./WashLocationController";
import { WashLocationService } from "./WashLocationService";

// Crear instancias para inyectar dependencias
const washLocationRepository = new PrismaWashLocationRepository();
const userRepository = new PrismaUserRepository();
const washLocationService = new WashLocationService(
	washLocationRepository,
	userRepository,
);
const washLocationController = new WashLocationController(washLocationService);

// Exportar las instancias y rutas
export {
	WashLocationService,
	WashLocationController,
	washLocationRoutes,
	washLocationController,
};
