// src/modules/subscription/SubscriptionService.ts

import { envConfig } from "../../config/envConfig";
import { warnAdminSubscription } from "../../emails/warnAdminSubscription";
import { Subscription } from "../../entities/Subscription";
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

    // ---------------------------------------------------------------------
    // Hydration helpers (garante entidade com métodos de domínio)
    // ---------------------------------------------------------------------

    private toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

        const d = new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    /**
     * Converte um "raw" (retorno de ORM) em instância de Subscription,
     * garantindo disponibilidade de métodos de domínio.
     */
    private hydrateSubscription(raw: any): Subscription {
        if (raw instanceof Subscription) {
            return raw;
        }

        const createdAt = this.toDate(raw?.createdAt) ?? new Date();
        const startDate =
            this.toDate(raw?.startDate) ??
            this.toDate(raw?.createdAt) ??
            new Date();

        const subscriptionStatus =
            raw?.subscriptionStatus ??
            (raw?.isActive ? "ACTIVE" : "SUSPENDED");

        return new Subscription({
            id: raw?.id ?? 0,
            userId: raw?.userId,
            carId: raw?.carId ?? undefined,
            planId: raw?.planId ?? undefined,
            planType: raw?.planType,
            amount: raw?.amount ?? 0,
            isActive: raw?.isActive ?? false,
            startDate,
            endDate: this.toDate(raw?.endDate),
            createdAt,
            updatedAt: this.toDate(raw?.updatedAt) ?? createdAt,
            expiresAt: this.toDate(raw?.expiresAt),
            paymentMethod: raw?.paymentMethod ?? "UNKNOWN",
            subscriptionIdAsaas: raw?.subscriptionIdAsaas ?? null,
            installmentIdAsaas: raw?.installmentIdAsaas ?? null,
            couponId: raw?.couponId ?? null,
            coupon: raw?.coupon ?? null,
            car: raw?.car ?? null,
            plan: raw?.plan ?? null,
            subscriptionStatus,
        });
    }

    // ---------------------------------------------------------------------
    // Cancelamento
    // ---------------------------------------------------------------------

    /**
     * Cancelamento de assinatura:
     * - Para plano recorrente (plan.isPackage = false):
     *   - Se existir subscriptionIdAsaas, cancela no ASAAS para impedir novas cobranças.
     *   - Se NÃO existir subscriptionIdAsaas, avisa o admin (inconsistência / migração / falha de vínculo).
     * - Para pacote (plan.isPackage = true):
     *   - Não existe assinatura recorrente no ASAAS para cancelar (normalmente é cobrança avulsa/pagamento).
     *
     * Importante:
     * - Cancelamento é idempotente: se já estiver cancelada, não falha.
     * - Regra de negócio NÃO deve depender de `isActive` como fonte de verdade.
     */
    public async cancelSubscription(subscriptionId: number): Promise<void> {
        const rawSubscription =
            await this.subscriptionRepository.findById(subscriptionId);

        if (!rawSubscription) {
            throw new AppError("Assinatura não encontrada", 404);
        }

        const subscription = this.hydrateSubscription(rawSubscription);

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

        const asaasId = subscription.subscriptionIdAsaas;

        // Recorrente: tenta cancelar no ASAAS (se possível).
        // Se não houver vínculo ASAAS e a assinatura ainda não estiver cancelada, avisa admin.
        if (!plan.isPackage) {
            if (!asaasId) {
                if (!subscription.isCanceled()) {
                    const { html, text, subject } = warnAdminSubscription(
                        `${user.name} (ID: ${user.id})`,
                    );

                    await this.mailingQueue.addToQueue({
                        to: envConfig.MAILER_ADMIN_EMAIL,
                        subject,
                        text,
                        html,
                    });
                }
            } else {
                // Mesmo se já cancelada localmente, manter tentativa de cancelamento ASAAS é aceitável.
                // Se ASAAS já estiver cancelada, tende a ser idempotente do lado de lá.
                await asaasCancelSubscription(asaasId);
            }
        }

        // Local: sempre marca como cancelada/inativa (repository deve ser idempotente).
        await this.subscriptionRepository.cancel(subscriptionId);
    }

    // ---------------------------------------------------------------------
    // Atualização (vínculo de veículo)
    // ---------------------------------------------------------------------

    /**
     * Atualiza uma assinatura existente (vínculo de veículo).
     * Regras:
     * - A assinatura deve existir.
     * - O carro deve existir.
     * - O carro deve pertencer ao mesmo usuário da assinatura.
     * - O carro não pode já ter outra assinatura ATIVA (diferente desta) vinculada.
     *
     * Importante:
     * - "Ativa" aqui é decidido por regra de domínio:
     *   subscriptionStatus === "ACTIVE" e expiresAt > now.
     * - Não depende do campo persistido `isActive`, que pode estar inconsistente em legado/migração.
     */
    public async updateSubscription(
        subscriptionId: number,
        data: UpdateSubscriptionDTO,
    ): Promise<Subscription> {
        const rawSubscription =
            await this.subscriptionRepository.findById(subscriptionId);

        if (!rawSubscription) {
            throw new AppError("Assinatura não encontrada", 404);
        }

        const subscription = this.hydrateSubscription(rawSubscription);

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
        const existingForCarRaw =
            await this.subscriptionRepository.findByCarLicensePlate(
                car.licensePlate,
            );

        if (existingForCarRaw) {
            const existingForCar = this.hydrateSubscription(existingForCarRaw);

            if (
                existingForCar.id !== subscription.id &&
                existingForCar.isCurrentlyActive()
            ) {
                throw new AppError(
                    "Este veículo já possui uma assinatura ativa vinculada",
                    400,
                );
            }
        }

        const updatedRaw = await this.subscriptionRepository.update(subscriptionId, {
            carId: car.id,
        });

        return this.hydrateSubscription(updatedRaw);
    }

    // ---------------------------------------------------------------------
    // Listagem
    // ---------------------------------------------------------------------

    /**
     * Lista assinaturas do usuário (incluindo car quando includeCars=true).
     * Retorna instâncias de domínio (com métodos).
     */
    public async listSubscriptions(userId: number): Promise<Subscription[]> {
        const raw = await this.subscriptionRepository.findByUserId(userId, true);
        return raw.map((s: any) => this.hydrateSubscription(s));
    }
}
