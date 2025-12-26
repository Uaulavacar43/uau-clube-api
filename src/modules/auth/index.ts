import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import { Mailer } from "../../third-party/Mailer";
import { AuthController } from "./AuthController";
import { AuthService } from "./AuthService";
import authRoutes from "./routes";
import { ReferralsService } from "../referrals/referrals.service";

const mailer = new Mailer();
const userRepository = new PrismaUserRepository();

/**
 * ✅ ReferralsService exige 1 argumento no construtor.
 * No padrão mais comum do teu projeto, ele precisa do userRepository.
 */
const referralsService = new ReferralsService(userRepository);

const authService = new AuthService(
    userRepository,
    referralsService,
    mailer,
);

const authController = new AuthController(authService);

export {
    authController,
    authService,
    authRoutes,
    userRepository,
    referralsService,
};
