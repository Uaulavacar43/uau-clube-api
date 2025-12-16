import { PrismaUserRepository } from "../../repositories/implementations/PrismaUserRepository";
import {ReferralsService} from "./referrals.service";
import {ReferralsController} from "./referrals.controller";


const userRepository = new PrismaUserRepository();

/**
 * FASE 1:
 * - validateReferral usa apenas userRepository
 * - referralRepository (bônus, camadas, etc.) não entra aqui ainda
 */
const referralsService = new ReferralsService(userRepository);

export const referralsController = new ReferralsController(referralsService);
