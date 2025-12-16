import { AppError } from "../../error/AppError";
import type { User } from "../../entities/User";
import { ReferralBonus } from "../../entities/ReferralBonus";
import type {
    CreateUserReferralInput,
    IUserRepository,
    ReferralSource,
} from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";

export interface AttachReferralOnSignupInput {
    userId: number;

    referralCode?: string;
    referrerId?: number;

    source?: ReferralSource;

    deviceId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: unknown;
}

export interface ValidateReferralResult {
    isValid: boolean;
    referrer: { id: number; name: string } | null;
}

export class ReferralsService {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly referralRepository?: IReferralRepository, // opcional (FASE 1)
    ) {}

    /**
     * Resolve o referrer (quem indicou) via referralCode.
     * Retorna null se não existir / inativo / vazio.
     */
    public async resolveReferrer(referralCode: string): Promise<User | null> {
        const code = (referralCode ?? "").trim();
        if (!code) return null;

        const referrer = await this.userRepository.findByReferralCode(code, false);
        if (!referrer) return null;

        if (referrer.status !== "ACTIVE") return null;

        return referrer;
    }

    /**
     * Retorna o mesmo payload do endpoint /referrals/validate:
     * - isValid: boolean
     * - referrer: { id, name } | null
     *
     * Assim o controller usa esse método e ele não fica "unused".
     */
    public async validateReferral(referralCode: string): Promise<ValidateReferralResult> {
        const referrer = await this.resolveReferrer(referralCode);

        return {
            isValid: Boolean(referrer),
            referrer: referrer ? { id: referrer.id, name: referrer.name } : null,
        };
    }

    public async attachReferralOnSignup(
        input: AttachReferralOnSignupInput,
    ): Promise<void> {
        const userId = Number(input.userId);

        if (!userId || Number.isNaN(userId)) {
            throw new AppError("userId inválido.", 400);
        }

        const source: ReferralSource = input.source ?? "UNKNOWN";

        const user = await this.userRepository.findById(userId, true);
        if (!user) {
            throw new AppError("Usuário não encontrado.", 404);
        }

        const hasAnyReferralInfo =
            (Boolean(input.referrerId) && Number(input.referrerId) > 0) ||
            Boolean((input.referralCode ?? "").trim());

        if (!hasAnyReferralInfo) {
            return;
        }

        if (user.referrerId && user.referrerId > 0) {
            throw new AppError("Usuário já possui referenciador associado.", 409);
        }

        const alreadyHasFormalReferral = await this.userRepository.hasReferralReceived(
            userId,
        );
        if (alreadyHasFormalReferral) {
            throw new AppError("Usuário já possui indicação registrada.", 409);
        }

        let referrer: User | null = null;

        if (input.referrerId && input.referrerId > 0) {
            referrer = await this.userRepository.findById(input.referrerId, false);
            if (!referrer) {
                throw new AppError("Referenciador não encontrado.", 404);
            }
            if (referrer.status !== "ACTIVE") {
                throw new AppError("Referenciador inativo.", 400);
            }
        }

        if (!referrer) {
            const code = (input.referralCode ?? "").trim();
            referrer = await this.resolveReferrer(code);

            if (!referrer) {
                throw new AppError("Código de indicação inválido.", 404);
            }
        }

        if (referrer.id === userId) {
            throw new AppError("Auto-indicação não é permitida.", 400);
        }

        await this.userRepository.updateReferrerId(userId, referrer.id);

        const referralAudit: CreateUserReferralInput = {
            referrerId: referrer.id,
            referredId: userId,
            source,
            deviceId: input.deviceId ?? null,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
            meta: input.meta,
        };

        await this.userRepository.createUserReferral(referralAudit);

        if (!this.referralRepository) {
            return;
        }

        await this.createPendingUniqueBonusesUpToLevel3({
            payerId: userId,
            level1ReceiverId: referrer.id,
        });
    }

    private async createPendingUniqueBonusesUpToLevel3(params: {
        payerId: number;
        level1ReceiverId: number;
    }): Promise<void> {
        if (!this.referralRepository) return;

        const { payerId, level1ReceiverId } = params;

        const level1 = new ReferralBonus({
            id: 0,
            receiverId: level1ReceiverId,
            payerId,
            level: 1,
            amount: 10,
            type: "UNIQUE",
            paymentStatus: "PENDING",
        });
        await this.referralRepository.save(level1);

        const level1Receiver = await this.userRepository.findById(
            level1ReceiverId,
            false,
        );
        const level2ReceiverId = level1Receiver?.referrerId ?? null;

        if (level2ReceiverId && level2ReceiverId > 0) {
            const level2Receiver = await this.userRepository.findById(
                level2ReceiverId,
                false,
            );
            if (level2Receiver && level2Receiver.status === "ACTIVE") {
                const level2 = new ReferralBonus({
                    id: 0,
                    receiverId: level2ReceiverId,
                    payerId,
                    level: 2,
                    amount: 5,
                    type: "UNIQUE",
                    paymentStatus: "PENDING",
                });
                await this.referralRepository.save(level2);
            }
        }

        if (level2ReceiverId && level2ReceiverId > 0) {
            const level2Receiver = await this.userRepository.findById(
                level2ReceiverId,
                false,
            );
            const level3ReceiverId = level2Receiver?.referrerId ?? null;

            if (level3ReceiverId && level3ReceiverId > 0) {
                const level3Receiver = await this.userRepository.findById(
                    level3ReceiverId,
                    false,
                );
                if (level3Receiver && level3Receiver.status === "ACTIVE") {
                    const level3 = new ReferralBonus({
                        id: 0,
                        receiverId: level3ReceiverId,
                        payerId,
                        level: 3,
                        amount: 5,
                        type: "UNIQUE",
                        paymentStatus: "PENDING",
                    });
                    await this.referralRepository.save(level3);
                }
            }
        }
    }
}
