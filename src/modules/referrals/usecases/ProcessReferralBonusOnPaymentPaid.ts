import { AppError } from "../../../error/AppError";
import type { IPaymentRepository } from "../../../repositories/interfaces/IPaymentRepository";
import type { IUserRepository } from "../../../repositories/interfaces/IUserRepository";
import type { IReferralRepository } from "../../../repositories/interfaces/IReferralRepository";
import { ReferralBonus } from "../../../entities/ReferralBonus";

export class ProcessReferralBonusOnPaymentPaid {
    constructor(
        private readonly paymentRepository: IPaymentRepository,
        private readonly userRepository: IUserRepository,
        private readonly referralBonusRepository: IReferralRepository,
    ) {}

    public async execute(paymentId: number): Promise<void> {
        if (!Number.isInteger(paymentId) || paymentId <= 0) {
            throw new AppError("paymentId inválido", 400);
        }

        const payment = await this.paymentRepository.getOneByFilter({ id: paymentId });

        if (!payment) {
            throw new AppError("Pagamento não encontrado", 404);
        }

        // 🔒 Regra da Fase 2
        if (payment.status !== "PAID") {
            return;
        }

        const payer = await this.userRepository.findById(payment.userId);

        if (!payer) {
            throw new AppError("Usuário pagador não encontrado", 404);
        }

        let currentReferrerId = payer.referrerId ?? null;

        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) break;

            const receiver = await this.userRepository.findById(currentReferrerId);

            if (!receiver || receiver.status !== "ACTIVE") {
                break;
            }

            const amount = this.resolveBonusAmount(level);

            const eventKey = `UNIQUE:payment:${payment.id}:level:${level}:receiver:${receiver.id}`;

            const bonus = new ReferralBonus({
                receiverId: receiver.id,
                payerId: payer.id,
                level,
                type: "UNIQUE",
                amount,
                paymentStatus: "PENDING",
                paymentId: payment.id,
                eventKey,
            });

            try {
                await this.referralBonusRepository.save(bonus);
            } catch (error: any) {
                /**
                 * 🔁 Idempotência real:
                 * retry de webhook / job duplicado
                 */
                if (
                    typeof error?.message === "string" &&
                    error.message.includes("Unique constraint failed")
                ) {
                    // já existe → segue a cadeia
                } else {
                    throw error;
                }
            }

            currentReferrerId = receiver.referrerId ?? null;
        }
    }

    private resolveBonusAmount(level: number): number {
        switch (level) {
            case 1:
                return 10;
            case 2:
                return 5;
            case 3:
                return 5;
            default:
                return 0;
        }
    }
}
