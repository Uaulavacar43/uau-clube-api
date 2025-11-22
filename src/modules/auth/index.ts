import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { Mailer } from "../../third-party/Mailer";
import { AuthController } from "./AuthController";
import { AuthService } from "./AuthService";
import authRoutes from "./routes";

const mailer = new Mailer();
const userRepository = new PrismaUserRepository();
const authService = new AuthService(userRepository, mailer);
const authController = new AuthController(authService);

export { authController, authService, authRoutes, userRepository };
