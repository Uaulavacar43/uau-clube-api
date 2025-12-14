// src/modules/subscription/SubscriptionService.ts

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

    /**
     * Cancelamento de assinatura:
     * - Para plano recorrente (plan.isPackage = false):
     *   - Se existir subscriptionIdAsaas, cancela no ASAAS para impedir novas cobranças.
     *   - Se NÃO existir subscriptionIdAsaas, avisa o admin (inconsistência / migração / falha de vínculo).
     * - Para pacote (plan.isPackage = true):
     *   - Não existe assinatura recorrente no ASAAS para cancelar (normalmente é cobrança avulsa/pagamento).
     *
     * Importante:
     * - O código anterior tinha uma regra impossível: exigia subscription.isActive = true,
     *   mas bloqueava o cancelamento se expiresAt > now (o que normalmente é verdade quando está ativa).
     * - Aqui o cancelamento é permitido e idempotente: se a assinatura existir, marcamos como cancelada localmente.
     */
    public async cancelSubscription(subscriptionId: number): Promise<void> {
        const subscription =
            await this.subscriptionRepository.findById(subscriptionId);

        if (!subscription) {
            throw new AppError("Assinatura não encontrada", 404);
        }

        if (!subscription.planId) {
            throw new AppError("Assinatura não possui plano vinculado", 400);
        }

        const plan = await this.planRepository.findById(subscription.planId);
        if (!plan) {
            throw new AppError("Plano não encontrado", 404);
        }

        const user = await this.userRepository.findById(subscription.userId);
        if (!user) {
            throw new AppError("Usuário não encontrado", 404);
        }

        const { html, text, subject } = warnAdminSubscription(
            `${user.name} (ID: ${user.id})`,
        );

        const asaasId = subscription.subscriptionIdAsaas;

        // Recorrente: tenta cancelar no ASAAS (se possível), ou avisa admin se faltou vínculo.
        if (!plan.isPackage) {
            if (!asaasId) {
                await this.mailingQueue.addToQueue({
                    to: envConfig.MAILER_ADMIN_EMAIL,
                    subject,
                    text,
                    html,
                });
            } else {
                await asaasCancelSubscription(asaasId);
            }
        }

        // Local: sempre marca como cancelada/inativa.
        // Observação: o método do repository atualiza isActive=false e endDate=agora.
        await this.subscriptionRepository.cancel(subscriptionId);
    }

    /**
     * Atualiza uma assinatura existente (vínculo de veículo).
     * Regras:
     * - A assinatura deve existir.
     * - O carro deve existir.
     * - O carro deve pertencer ao mesmo usuário da assinatura.
     * - O carro não pode já ter outra assinatura ativa (diferente desta) vinculada.
     */
    public async updateSubscription(
        subscriptionId: number,
        data: UpdateSubscriptionDTO,
    ): Promise<Subscription> {
        const subscription =
            await this.subscriptionRepository.findById(subscriptionId);

        if (!subscription) {
            throw new AppError("Assinatura não encontrada", 404);
        }

        const car = await this.carRepository.findById(data.carId);
        if (!car) {
            throw new AppError("Veículo não encontrado", 404);
        }

        // Integridade: o veículo precisa pertencer ao mesmo usuário da assinatura
        if (car.userId !== subscription.userId) {
            throw new AppError(
                "Este veículo não pertence ao usuário associado a esta assinatura",
                400,
            );
        }

        // Proteção: não permite vincular a assinatura a um carro que já tenha assinatura ativa diferente
        // (evita duplicidade de direito de uso por placa).
        const existingActiveForCar =
            await this.subscriptionRepository.findByCarLicensePlate(
                car.licensePlate,
            );

        if (
            existingActiveForCar &&
            existingActiveForCar.id !== subscription.id
        ) {
            throw new AppError(
                "Este veículo já possui uma assinatura ativa vinculada",
                400,
            );
        }

        return await this.subscriptionRepository.update(subscriptionId, {
            carId: car.id,
        });
    }

    /**
     * Lista assinaturas do usuário (incluindo car quando includeCars=true).
     */
    public async listSubscriptions(userId: number): Promise<Subscription[]> {
        return await this.subscriptionRepository.findByUserId(userId, true);
    }
}
