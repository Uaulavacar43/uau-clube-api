import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../entities/ReferralBonus";

export class ReferralBonusService {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly referralRepository: IReferralRepository,
    ) {}

    /**
     * Gera bônus de indicação (nível 1..3) no PRIMEIRO pagamento PAID de uma assinatura.
     *
     * Idempotência: payerId + subscriptionId (via eventKey UNIQUE no banco)
     */
    public async generateOnFirstPaidSubscription(params: {
        payerId: number;
        subscriptionId: number;
    }): Promise<void> {
        const payerId = Number(params.payerId);
        const subscriptionId = Number(params.subscriptionId);

        if (!Number.isInteger(payerId) || payerId <= 0) return;
        if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) return;

        // 1) Idempotência (contrato do repo: 2 argumentos)
        const alreadyGenerated =
            await this.referralRepository.hasUniqueBonusForPayerSubscription(
                payerId,
                subscriptionId,
            );

        if (alreadyGenerated) return;

        // 2) Payer
        const payer = await this.userRepository.findById(payerId, false);
        if (!payer) return;

        const level1Id = (payer as any).referrerId ?? null;
        if (!level1Id || level1Id <= 0) return;

        // Helper: status ativo (mantém compatibilidade se status não existir)
        const isActive = (u: any) => !u?.status || u.status === "ACTIVE";

        // LEVEL 1
        const level1User = await this.userRepository.findById(level1Id, false);
        if (level1User && isActive(level1User)) {
            await this.referralRepository.save(
                new ReferralBonus({
                    id: 0,
                    receiverId: level1Id,
                    payerId,
                    level: 1,
                    amount: 10,
                    type: "UNIQUE",
                    paymentStatus: "PAID",
                    eventKey: `UNIQUE:SUB:${subscriptionId}:PAYER:${payerId}:L1`,
                }),
            );
        }

        // LEVEL 2
        const level2Id = (level1User as any)?.referrerId ?? null;
        if (level2Id && level2Id > 0) {
            const level2User = await this.userRepository.findById(level2Id, false);

            if (level2User && isActive(level2User)) {
                await this.referralRepository.save(
                    new ReferralBonus({
                        id: 0,
                        receiverId: level2Id,
                        payerId,
                        level: 2,
                        amount: 5,
                        type: "UNIQUE",
                        paymentStatus: "PAID",
                        eventKey: `UNIQUE:SUB:${subscriptionId}:PAYER:${payerId}:L2`,
                    }),
                );
            }

            // LEVEL 3
            const level3Id = (level2User as any)?.referrerId ?? null;
            if (level3Id && level3Id > 0) {
                const level3User = await this.userRepository.findById(level3Id, false);

                if (level3User && isActive(level3User)) {
                    await this.referralRepository.save(
                        new ReferralBonus({
                            id: 0,
                            receiverId: level3Id,
                            payerId,
                            level: 3,
                            amount: 5,
                            type: "UNIQUE",
                            paymentStatus: "PAID",
                            eventKey: `UNIQUE:SUB:${subscriptionId}:PAYER:${payerId}:L3`,
                        }),
                    );
                }
            }
        }
    }
}
