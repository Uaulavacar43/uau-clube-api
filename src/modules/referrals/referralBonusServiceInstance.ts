// src/modules/referrals/referralBonusServiceInstance.ts

import prisma from "../../config/dbConfig";
import { ReferralBonusService } from "./ReferralBonusService";

import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";

/**
 * Instância singleton do ReferralBonusService para ser usada no bootstrap (server.ts).
 *
 * - userRepository: implementa só o que o service usa (findById)
 * - referralRepository: não é usado dentro do ReferralBonusService (mantido por compat),
 *   então passamos um stub.
 */

const userRepository: IUserRepository = {
    async findById(id: number, _withPassword?: boolean) {
        const userId = Number(id);
        if (!userId || Number.isNaN(userId)) return null;

        // Ajuste o model/where conforme seu schema (normalmente prisma.user)
        return prisma.user.findUnique({
            where: { id: userId },
        }) as any;
    },
} as any;

const referralRepository: IReferralRepository = {} as any;

export const referralBonusService = new ReferralBonusService(userRepository, referralRepository);
