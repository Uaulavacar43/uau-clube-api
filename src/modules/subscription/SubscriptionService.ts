import { envConfig } from "../../config/envConfig";
import { warnAdminSubscription } from "../../emails/warnAdminSubscription";
import type { Subscription } from "../../entities/Subscription";
import { AppError } from "../../error/AppError";
import type { MailingQueue } from "../../queues/MailingQueue";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import { asaasCancelSubscription } from "../../utils/asaas/asaasSubscriptions";
import type { UpdateSubscriptionDTO } from "./dto/UpdateSubscriptionDTO";

export class SubscriptionService {
    constructor(
        private subscriptionRepository: ISubscriptionRepository,
        private carRepository: IUserCarRepository,
        private planRepository: IPlanRepository,
        private userRepository: IUserRepository,
        private mailingQueue: MailingQueue,
    ) {}

    // Função para cancelar uma assinatura existente
    public async cancelSubscription(subscriptionId: number): Promise<void> {
        const subscription = await this.subscriptionRepository.findById(subscriptionId);

        if (!subscription || !subscription.isActive || !subscription.planId) {
            throw new AppError("Assinatura não encontrada ou já está inativa", 404);
        }

        const plan = await this.planRepository.findById(subscription.planId);
        if (!plan) {
            throw new AppError("Plano não encontrado", 404);
        }

        const user = await this.userRepository.findById(subscription.userId);
        if (!user) {
            throw new AppError("Usuário não encontrado", 404);
        }

        if (subscription.expiresAt && subscription.expiresAt > new Date()) {
            throw new AppError(
                "Você não pode cancelar uma assinatura que ainda não expirou",
                400,
            );
        }

        const { html, text, subject } = warnAdminSubscription(
            `${user.name} (ID: ${user.id})`,
        );

        // Fazemos o narrowing em cima de uma variável local
        const asaasId = subscription.subscriptionIdAsaas;

        // Mantém a mesma tabela verdade do teu código original, só que de forma
        // que o TS consiga enxergar que `asaasId` é string no último branch.
        if (!asaasId && !plan.isPackage) {
            // Caso 1: não tem subscriptionIdAsaas e não é pacote → avisa admin
            await this.mailingQueue.addToQueue({
                to: envConfig.MAILER_ADMIN_EMAIL,
                subject,
                text,
                html,
            });
        } else if (!asaasId) {
            // Caso 2: não tem subscriptionIdAsaas e é pacote → também avisa admin
            await this.mailingQueue.addToQueue({
                to: envConfig.MAILER_ADMIN_EMAIL,
                subject,
                text,
                html,
            });
        } else if (!plan.isPackage) {
            // Caso 3: tem subscriptionIdAsaas e não é pacote → cancela no Asaas
            // Aqui o TS sabe que asaasId é string
            await asaasCancelSubscription(asaasId);
        }
        // Caso 4: asaasId existe e plan.isPackage = true → não faz nada (igual original)

        await this.subscriptionRepository.cancel(subscriptionId);
    }

    // Função para atualizar uma assinatura existente
    public async updateSubscription(
        subscriptionId: number,
        data: UpdateSubscriptionDTO,
    ): Promise<Subscription> {
        const subscription = await this.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new AppError("Assinatura não encontrada", 404);
        }

        const car = await this.carRepository.findById(data.carId);
        if (!car) {
            throw new AppError("Veículo não encontrado", 404);
        }

        // Garante integridade: o veículo precisa pertencer ao mesmo usuário da assinatura
        if (car.userId !== subscription.userId) {
            throw new AppError(
                "Este veículo não pertence ao usuário associado a esta assinatura",
                400,
            );
        }

        // Se quiser bloquear atualização de assinaturas inativas, basta descomentar:
        // if (!subscription.isActive) {
        // 	throw new AppError(
        // 		"Assinatura está inativa e não pode ser atualizada",
        // 		400,
        // 	);
        // }

        return await this.subscriptionRepository.update(subscriptionId, {
            carId: car.id,
        });
    }

    // Função para listar assinaturas de um usuário
    public async listSubscriptions(userId: number): Promise<Subscription[]> {
        return await this.subscriptionRepository.findByUserId(userId, true);
    }
}
