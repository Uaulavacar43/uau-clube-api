// src/modules/payment/services/SubscriptionLifecycleService.ts

import type { Coupon } from "../../entities/Coupon";
import type { Payment } from "../../entities/Payment";
import { PeriodicityType, type Plan } from "../../entities/Plan";
import { Subscription } from "../../entities/Subscription";
import { AppError } from "../../error/AppError";

import type { IPaymentRepository } from "../../repositories/interfaces/IPaymentRepository";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";

import { asaasCreatePayment, asaasGetPixQrCode } from "../../utils/asaas/asaasPayments";
import { asaasCreateSubscription } from "../../utils/asaas/asaasSubscriptions";
import { ASAASPaymentBillingTypeEnum, ASAASPaymentStatusEnum } from "../../utils/asaas/types/paymentTypes";
import {
    type ASAASCreateSubscriptionDTO,
    ASAASSubscriptionBillingTypeEnum,
    ASAASSubscriptionCycleEnum,
} from "../../utils/asaas/types/subscriptionTypes";
import { ASAASWebhookEventEnum, type ASAASWebhookEvent } from "../../utils/asaas/types/webhookTypes";

import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";

// Fonte de verdade de policy + externalReference
import { PaymentPolicy } from "./PaymentPolicy";
import { AsaasBillingService } from "./AsaasBillingService";

// Para tipar payload diretamente da função util
type AsaasCreatePaymentPayload = Parameters<typeof asaasCreatePayment>[0];

type CouponPricingResult = {
    finalAmount: number;
};

type CashbackUsageResult = {
    cashbackUsed: number;
    amountAfterCashback: number;
};

/**
 * Serviço focado no ciclo de vida de assinatura:
 * - hidratação de Subscription com métodos de domínio
 * - cálculo de expiração
 * - update de validade com base em pagamento
 * - reconciliação de assinaturas ao adicionar carro
 * - criação de assinatura recorrente no ASAAS (createAsaasSubscription)
 * - handler do webhook de subscription (SUBSCRIPTION_CREATED / cancelamento)
 *
 * IMPORTANTE:
 * - ExternalReference (build/parse) => PaymentPolicy (não repete aqui)
 * - map status / resolve paymentType => AsaasBillingService (não repete aqui)
 */
export class SubscriptionLifecycleService {
    private readonly asaasBilling = new AsaasBillingService();

    constructor(
        private readonly subscriptionRepository: ISubscriptionRepository,
        private readonly planRepository: IPlanRepository,
        private readonly userRepository: IUserRepository,
        private readonly paymentRepository: IPaymentRepository,
        private readonly carRepository: IUserCarRepository,
    ) {}

    // ---------------------------------------------------------------------
    // Hydration helpers (garante entidade com métodos de domínio e Dates)
    // ---------------------------------------------------------------------

    /**
     * Converte um "raw" (retorno de ORM/repo) em instância de Subscription,
     * garantindo disponibilidade dos métodos:
     * - isCurrentlyActive()
     * - isExpired()
     * - isCanceled()
     */
    public hydrateSubscription(raw: any): Subscription {
        if (!raw) {
            throw new AppError("Assinatura inválida (objeto nulo)", 500);
        }

        if (raw instanceof Subscription) {
            return raw;
        }

        const createdAt = PaymentPolicy.toDate(raw?.createdAt) ?? new Date();
        const startDate = PaymentPolicy.toDate(raw?.startDate) ?? PaymentPolicy.toDate(raw?.createdAt) ?? new Date();

        const updatedAt = PaymentPolicy.toDate(raw?.updatedAt) ?? createdAt;
        const expiresAt = PaymentPolicy.toDate(raw?.expiresAt);
        const endDate = PaymentPolicy.toDate(raw?.endDate);

        const planType: PeriodicityType =
            raw?.planType ?? raw?.plan?.periodicityType ?? PeriodicityType.MONTH;

        const subscriptionStatus = raw?.subscriptionStatus ?? (raw?.isActive ? "ACTIVE" : "SUSPENDED");

        return new Subscription({
            id: raw?.id ?? 0,
            userId: raw?.userId,
            carId: raw?.carId ?? undefined,
            planId: raw?.planId ?? undefined,
            planType,
            amount: raw?.amount ?? 0,
            isActive: raw?.isActive ?? false,
            startDate,
            endDate,
            createdAt,
            updatedAt,
            expiresAt,
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
    // Helpers de plano / assinatura
    // ---------------------------------------------------------------------

    /**
     * Para PLANO RECORRENTE (assinatura ASAAS):
     * - nextDueDate precisa ir para o PRÓXIMO CICLO
     * - e a 1ª mensalidade é uma cobrança avulsa "agora"
     */
    private calculateNextSubscriptionDueDate(plan: Plan, referenceDate: Date): Date {
        const base = new Date(referenceDate.getTime());

        switch (plan.periodicityType) {
            case PeriodicityType.WEEK:
                base.setDate(base.getDate() + 7);
                break;

            case PeriodicityType.MONTH:
                base.setMonth(base.getMonth() + 1);
                break;

            case PeriodicityType.QUARTERLY:
                base.setMonth(base.getMonth() + 3);
                break;

            case PeriodicityType.SEMIANNUALLY:
                base.setMonth(base.getMonth() + 6);
                break;

            case PeriodicityType.YEAR:
                base.setFullYear(base.getFullYear() + 1);
                break;

            default:
                base.setMonth(base.getMonth() + 1);
                break;
        }

        return base;
    }

    public calculatePlanExpiration(plan: Plan, referenceDate: Date): Date {
        const baseDate = new Date(referenceDate.getTime());

        if (plan.duration !== undefined && plan.duration !== null && plan.duration > 0) {
            baseDate.setDate(baseDate.getDate() + plan.duration);
        } else {
            switch (plan.periodicityType) {
                case PeriodicityType.WEEK:
                    baseDate.setDate(baseDate.getDate() + 7);
                    break;
                case PeriodicityType.MONTH:
                    baseDate.setDate(baseDate.getDate() + 30);
                    break;
                case PeriodicityType.QUARTERLY:
                    baseDate.setMonth(baseDate.getMonth() + 3);
                    break;
                case PeriodicityType.SEMIANNUALLY:
                    baseDate.setMonth(baseDate.getMonth() + 6);
                    break;
                case PeriodicityType.YEAR:
                    baseDate.setFullYear(baseDate.getFullYear() + 1);
                    break;
                default:
                    break;
            }
        }

        if (plan.extraMonths !== undefined && plan.extraMonths !== null && plan.extraMonths > 0) {
            baseDate.setMonth(baseDate.getMonth() + plan.extraMonths);
        }

        return baseDate;
    }

    public async updateSubscriptionValidityFromPayment(
        subscriptionInput: Subscription,
        paymentDate: Date,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void> {
        const subscription = this.hydrateSubscription(subscriptionInput);

        if (newStatus === "CANCELED") {
            subscription.isActive = false;
            subscription.subscriptionStatus = "CANCELED";
            subscription.endDate = paymentDate;

            await this.subscriptionRepository.update(subscription.id, subscription);

            console.log(
                `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} marcada como CANCELED e isActive = false (cancelamento explícito).`,
            );
            return;
        }

        if (newStatus !== "PAID") {
            return;
        }

        if (subscription.isCanceled()) {
            subscription.isActive = false;
            await this.subscriptionRepository.update(subscription.id, subscription);
            return;
        }

        if (!subscription.planId) {
            console.warn(
                `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} sem planId. Ignorando cálculo de validade.`,
            );
            return;
        }

        const plan = await this.planRepository.findById(subscription.planId);
        if (!plan) {
            console.warn(
                `[updateSubscriptionValidityFromPayment] Plano ${subscription.planId} não encontrado. Ignorando cálculo de validade.`,
            );
            return;
        }

        if (subscription.planType !== plan.periodicityType) {
            subscription.planType = plan.periodicityType;
        }

        const hasFutureExpiration =
            subscription.expiresAt !== undefined &&
            subscription.expiresAt !== null &&
            subscription.expiresAt.getTime() > paymentDate.getTime();

        const referenceBase = hasFutureExpiration ? (subscription.expiresAt as Date) : paymentDate;

        const expiresAt = this.calculatePlanExpiration(plan, referenceBase);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        if (!subscription.startDate) {
            subscription.startDate = paymentDate;
        }

        subscription.expiresAt = expiresAt;
        subscription.isActive = isActive;

        const expired = subscription.isExpired(now);

        if (subscription.isCanceled()) {
            subscription.isActive = false;
        } else {
            subscription.subscriptionStatus = !expired ? "ACTIVE" : "SUSPENDED";
            if (expired) {
                subscription.endDate = expiresAt;
            }
        }

        await this.subscriptionRepository.update(subscription.id, subscription);

        console.log(
            `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} atualizada => isActive: ${subscription.isActive}, subscriptionStatus: ${subscription.subscriptionStatus}, startDate: ${subscription.startDate.toISOString()}, expiresAt: ${subscription.expiresAt?.toISOString()}`,
        );
    }

    public validatePlanInstallments(plan: Plan, installments?: number): true {
        if (!installments || installments <= 1) {
            return true;
        }

        const maxInstallments = plan.maxInstallments ?? 0;

        if (maxInstallments <= 0) {
            throw new AppError("Este plano não permite parcelamento", 400);
        }

        if (installments > maxInstallments) {
            throw new AppError(`Este plano permite parcelamento em até ${maxInstallments}x`, 400);
        }

        if (plan.periodicityType === PeriodicityType.YEAR && installments > 12) {
            throw new AppError("O plano anual não pode ter mais de 12 parcelas", 400);
        }

        if (plan.periodicityType === PeriodicityType.QUARTERLY && installments > 3) {
            throw new AppError("O plano trimestral não pode ter mais de 3 parcelas", 400);
        }

        if (plan.periodicityType === PeriodicityType.SEMIANNUALLY && installments > 6) {
            throw new AppError("O plano semestral não pode ter mais de 6 parcelas", 400);
        }

        return true;
    }

    // ---------------------------------------------------------------------
    // ✅ Carro tem assinatura ativa? (REGRA NOVA: precisa de userId)
    // ---------------------------------------------------------------------

    public async carHasSubscription(userId: number, licensePlate: string): Promise<boolean> {
        const normalizedPlate = PaymentPolicy.normalizePlate(licensePlate);
        if (!normalizedPlate) return false;

        const existingRaw = await this.subscriptionRepository.findByCarLicensePlateAndUserId(
            normalizedPlate,
            userId,
        );

        if (!existingRaw) return false;

        const existing = this.hydrateSubscription(existingRaw);
        return existing.isCurrentlyActive();
    }

    // ---------------------------------------------------------------------
    // Reconciliação / garantia de assinatura com base em pagamentos existentes
    // ---------------------------------------------------------------------

    private async findLastPaidPlanPaymentForUser(userId: number): Promise<Payment | null> {
        try {
            const payments = await this.paymentRepository.getAll({ userId });

            if (payments.length === 0) {
                console.log(`[findLastPaidPlanPaymentForUser] Nenhum pagamento encontrado para userId=${userId}.`);
                return null;
            }

            const sorted = [...payments].sort((a, b) => {
                const aDate = (a.paymentDate ?? a.createdAt ?? new Date(0)).getTime();
                const bDate = (b.paymentDate ?? b.createdAt ?? new Date(0)).getTime();
                return bDate - aDate;
            });

            const lastPaidWithPlan = sorted.find(
                (paymentItem) =>
                    paymentItem.status === "PAID" && paymentItem.planId !== undefined && paymentItem.planId !== null,
            );

            if (!lastPaidWithPlan) {
                console.log(`[findLastPaidPlanPaymentForUser] Nenhum pagamento PAID com plano encontrado para userId=${userId}.`);
                return null;
            }

            return lastPaidWithPlan;
        } catch (error) {
            console.error(`[findLastPaidPlanPaymentForUser] Erro ao buscar pagamento PAID para userId=${userId}:`, error);
            return null;
        }
    }

    public async ensureSubscriptionForUserAndCarFromExistingPayments(userId: number, carId: number): Promise<void> {
        const car = await this.carRepository.findById(carId);

        if (!car) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Carro ${carId} não encontrado para userId=${userId}.`,
            );
            return;
        }

        const normalizedPlate = PaymentPolicy.normalizePlate((car as any).licensePlate);

        if (!normalizedPlate) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Carro ${carId} sem placa válida para userId=${userId}.`,
            );
            return;
        }

        // ✅ REGRA NOVA: placa + userId (remove legado global)
        const subscriptionByPlateRaw = await this.subscriptionRepository.findByCarLicensePlateAndUserId(
            normalizedPlate,
            userId,
        );

        if (subscriptionByPlateRaw) {
            const subscriptionByPlate = this.hydrateSubscription(subscriptionByPlateRaw);

            if (subscriptionByPlate.userId !== userId) {
                console.warn(
                    `[ensureSubscriptionForUserAndCarFromExistingPayments] Atenção: assinatura encontrada por placa ${normalizedPlate} pertence a outro usuário (subscription.userId=${subscriptionByPlate.userId}, userId=${userId}). Não vinculando carId.`,
                );
                return;
            }

            if (subscriptionByPlate.carId === undefined || subscriptionByPlate.carId === null) {
                subscriptionByPlate.carId = carId;

                await this.subscriptionRepository.update(subscriptionByPlate.id, subscriptionByPlate);

                console.log(
                    `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ${subscriptionByPlate.id} vinculada ao carro ${carId} pela placa ${normalizedPlate}.`,
                );
            }

            if (!subscriptionByPlate.isCurrentlyActive() && !subscriptionByPlate.isCanceled()) {
                const lastPaidPayment = await this.findLastPaidPlanPaymentForUser(userId);

                if (lastPaidPayment && lastPaidPayment.planId === subscriptionByPlate.planId) {
                    const paymentDate = lastPaidPayment.paymentDate ?? lastPaidPayment.createdAt ?? new Date();

                    await this.updateSubscriptionValidityFromPayment(subscriptionByPlate, paymentDate, "PAID");

                    await this.subscriptionRepository.update(subscriptionByPlate.id, subscriptionByPlate);
                } else {
                    console.log(
                        `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ${subscriptionByPlate.id} encontrada por placa, porém sem pagamento PAID compatível (planId). Mantendo estado atual.`,
                    );
                }
            }

            return;
        }

        const userSubscriptionsRaw = await this.subscriptionRepository.findByUserId(userId, true);
        const userSubscriptions = userSubscriptionsRaw.map((s: any) => this.hydrateSubscription(s));

        const activeSubscriptionWithoutCar = userSubscriptions.find(
            (subscriptionItem) =>
                subscriptionItem.isCurrentlyActive() && (subscriptionItem.carId === undefined || subscriptionItem.carId === null),
        );

        if (activeSubscriptionWithoutCar) {
            activeSubscriptionWithoutCar.carId = carId;

            await this.subscriptionRepository.update(activeSubscriptionWithoutCar.id, activeSubscriptionWithoutCar);

            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ativa ${activeSubscriptionWithoutCar.id} vinculada ao carro ${carId} para o usuário ${userId}.`,
            );

            return;
        }

        const lastPaidPayment = await this.findLastPaidPlanPaymentForUser(userId);

        if (!lastPaidPayment || lastPaidPayment.planId === undefined || lastPaidPayment.planId === null) {
            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Nenhum pagamento PAID com plano encontrado para userId=${userId}. Nenhuma assinatura será criada.`,
            );
            return;
        }

        const plan = await this.planRepository.findById(lastPaidPayment.planId);
        if (!plan) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Plano ${lastPaidPayment.planId} não encontrado para userId=${userId}.`,
            );
            return;
        }

        const paymentDate = lastPaidPayment.paymentDate ?? lastPaidPayment.createdAt ?? new Date();

        let subscriptionForPlan = userSubscriptions.find((subscriptionItem) => subscriptionItem.planId === plan.id);

        if (subscriptionForPlan) {
            subscriptionForPlan.carId = carId;

            await this.updateSubscriptionValidityFromPayment(subscriptionForPlan, paymentDate, "PAID");

            await this.subscriptionRepository.update(subscriptionForPlan.id, subscriptionForPlan);

            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura existente ${subscriptionForPlan.id} atualizada a partir do pagamento e vinculada ao carro ${carId}.`,
            );

            return;
        }

        const expiresAt = this.calculatePlanExpiration(plan, paymentDate);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        const paymentMethodSafe: string =
            (lastPaidPayment as any).paymentMethodId && (lastPaidPayment as any).paymentMethodId.trim().length > 0
                ? (lastPaidPayment as any).paymentMethodId
                : "UNKNOWN";

        const subscription = new Subscription({
            userId,
            planId: plan.id,
            planType: plan.periodicityType,
            amount: PaymentPolicy.ensureMinimumAmount((lastPaidPayment as any).amount, PaymentPolicy.MINIMUM_CHARGE_AMOUNT),
            isActive,
            startDate: paymentDate,
            carId,
            expiresAt,
            paymentMethod: paymentMethodSafe,
            couponId: (lastPaidPayment as any).couponId ?? null,
            subscriptionStatus: isActive ? "ACTIVE" : "SUSPENDED",
            endDate: isActive ? null : expiresAt,
            subscriptionIdAsaas: null,
        });

        const createdSubscriptionRaw = await this.subscriptionRepository.create(subscription);
        const createdSubscription = this.hydrateSubscription(createdSubscriptionRaw);

        console.log(
            `[ensureSubscriptionForUserAndCarFromExistingPayments] Nova assinatura ${createdSubscription.id} criada a partir do pagamento PAID e vinculada ao carro ${carId}. isActive=${createdSubscription.isActive}, expiresAt=${createdSubscription.expiresAt?.toISOString()}`,
        );
    }

    public async ensureSubscriptionWhenCarAdded(userId: number, carId: number): Promise<void> {
        await this.ensureSubscriptionForUserAndCarFromExistingPayments(userId, carId);
    }

    // ---------------------------------------------------------------------
    // ✅ PLANO RECORRENTE (ASSINATURA ASAAS) - IDÊNTICO AO PaymentService
    // ---------------------------------------------------------------------

    public async createAsaasSubscription(
        data: CreateSubscriptionToPlanDTO & { userId: number },
        plan: Plan,
        customerId: string,
        coupon: Coupon | null,
        billingType: ASAASSubscriptionBillingTypeEnum,
        pricing: {
            startDate: Date;
            timeZoneOffsetMinutes: number;
            requestedCashback: number;
            planCouponPricing: CouponPricingResult;
            cashbackPricing: CashbackUsageResult;
        },
    ): Promise<{
        subscription: Subscription;
        payment: Payment | null;
    }> {
        try {
            const mapCycle = new Map<PeriodicityType, ASAASSubscriptionCycleEnum>([
                [PeriodicityType.WEEK, ASAASSubscriptionCycleEnum.WEEKLY],
                [PeriodicityType.MONTH, ASAASSubscriptionCycleEnum.MONTHLY],
                [PeriodicityType.QUARTERLY, ASAASSubscriptionCycleEnum.QUARTERLY],
                [PeriodicityType.SEMIANNUALLY, ASAASSubscriptionCycleEnum.SEMIANNUALLY],
                [PeriodicityType.YEAR, ASAASSubscriptionCycleEnum.YEARLY],
            ]);

            const cycle = mapCycle.get(plan.periodicityType);
            if (!cycle) {
                throw new AppError(
                    `Este período de assinatura não existe ou não é permitido neste formato: ${plan.periodicityType}`,
                    400,
                );
            }

            const paymentType = this.asaasBilling.resolvePaymentType((data as any)?.type);

            const creditCard = paymentType === "creditCard" ? (data as any)?.creditCard : undefined;
            const creditCardHolderInfo = paymentType === "creditCard" ? (data as any)?.creditCardHolderInfo : undefined;

            if (billingType === ASAASSubscriptionBillingTypeEnum.CREDIT_CARD) {
                if (!creditCard) throw new AppError("Faltam informações cartão", 400);
                if (!creditCardHolderInfo) throw new AppError("Faltam informações do titular do cartão", 400);
            }

            // ✅ Usa a data/timezone já calculadas no fluxo principal (clamp seguro)
            const startDate = pricing.startDate;
            const timeZoneOffsetMinutes = PaymentPolicy.resolveTimeZoneOffsetMinutes(pricing.timeZoneOffsetMinutes, -180);

            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            // 1) Cria assinatura local (SUSPENDED até pagamento da 1ª mensalidade)
            const localSubscriptionRaw = await this.subscriptionRepository.create(
                new Subscription({
                    userId: data.userId,
                    planId: plan.id,
                    planType: plan.periodicityType,
                    amount: plan.price,
                    isActive: false,
                    startDate,
                    carId: (data as any)?.carId,
                    paymentMethod: billingType,
                    subscriptionIdAsaas: null,
                    couponId: coupon?.id ?? null, // registro interno (cupom aplicado na 1ª cobrança avulsa)
                    expiresAt,
                    subscriptionStatus: "SUSPENDED",
                    endDate: null,
                }),
            );

            const localSubscription = this.hydrateSubscription(localSubscriptionRaw);

            // 2) Cria assinatura ASAAS com VALOR CHEIO e nextDueDate no PRÓXIMO ciclo
            const nextDueDate = this.calculateNextSubscriptionDueDate(plan, startDate);

            // ⚠️ IMPORTANTE:
            // externalReference da ASSINATURA NÃO deve carregar cashback/cupom,
            // senão o webhook pode "contaminar" pagamentos futuros.
            const subscriptionExternalReference = PaymentPolicy.buildAsaasExternalReference({
                userId: data.userId,
                planId: plan.id,
                subId: localSubscription.id,
                minimumCharge: PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
                timeZoneOffsetMinutes,
            });

            const payload: ASAASCreateSubscriptionDTO = {
                customer: customerId,
                nextDueDate: PaymentPolicy.isoDateString(nextDueDate),
                value: plan.price, // valor cheio sempre
                billingType,
                cycle,
                description: `Plano recorrente: ${plan.name}`,
                externalReference: subscriptionExternalReference,
            } as ASAASCreateSubscriptionDTO;

            if (billingType === ASAASSubscriptionBillingTypeEnum.CREDIT_CARD) {
                (payload as any).creditCard = creditCard;
                (payload as any).creditCardHolderInfo = creditCardHolderInfo;
            }

            console.log("[createAsaasSubscription] Criando assinatura no Asaas (valor cheio + nextDueDate próximo ciclo)...");
            const asaasSubscription = await asaasCreateSubscription(payload, customerId);

            localSubscription.subscriptionIdAsaas = asaasSubscription.id;
            localSubscription.amount = asaasSubscription.value;

            await this.subscriptionRepository.update(localSubscription.id, localSubscription);

            console.log(
                `[createAsaasSubscription] Assinatura Asaas ${asaasSubscription.id} vinculada ao ID local ${localSubscription.id}. nextDueDate=${PaymentPolicy.isoDateString(nextDueDate)}`,
            );

            // 3) Cria a cobrança avulsa AGORA (1ª mensalidade) com cashback/cupom abatidos
            const paymentBillingType =
                billingType === ASAASSubscriptionBillingTypeEnum.PIX
                    ? ASAASPaymentBillingTypeEnum.PIX
                    : ASAASPaymentBillingTypeEnum.CREDIT_CARD;

            const safeFinalAmount = PaymentPolicy.ensureMinimumAmount(
                pricing.cashbackPricing.amountAfterCashback,
                PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
            );

            const firstDueDateStr = PaymentPolicy.isoDateString(startDate);
            const firstDueAt = PaymentPolicy.parseIsoDateToDate(firstDueDateStr) ?? startDate;

            // externalReference do PAGAMENTO AVULSO pode carregar cashback/cupom
            const firstPaymentExternalReference = PaymentPolicy.buildAsaasExternalReference({
                userId: data.userId,
                planId: plan.id,
                subId: localSubscription.id,
                couponId: coupon?.id,
                cashbackUsedAmount: pricing.cashbackPricing.cashbackUsed,
                cashbackBaseAmount: pricing.planCouponPricing.finalAmount, // base após cupom
                cashbackRequestedAmount: pricing.requestedCashback,
                minimumCharge: PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
                timeZoneOffsetMinutes,
            });

            const firstPaymentPayload: AsaasCreatePaymentPayload = {
                billingType: paymentBillingType,
                dueDate: firstDueDateStr,
                value: safeFinalAmount,
                customer: customerId,
                description: `1ª mensalidade (cashback/cupom aplicado): ${plan.name}`,
                externalReference: firstPaymentExternalReference,
            };

            if (paymentBillingType === ASAASPaymentBillingTypeEnum.CREDIT_CARD) {
                (firstPaymentPayload as any).creditCard = creditCard;
                (firstPaymentPayload as any).creditCardHolderInfo = creditCardHolderInfo;
            }

            console.log("[createAsaasSubscription] Criando cobrança avulsa da 1ª mensalidade (com desconto)...");
            const asaasFirstPayment = await asaasCreatePayment(firstPaymentPayload);

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;

            if (paymentBillingType === ASAASPaymentBillingTypeEnum.PIX) {
                console.log("[createAsaasSubscription] Recuperando QR code PIX da 1ª mensalidade...");
                const asaasPixCode = await asaasGetPixQrCode(asaasFirstPayment.id);
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log("[createAsaasSubscription] QR code PIX recuperado e pronto para o cliente.");
            }

            const internalStatus = this.asaasBilling.mapAsaasPaymentStatusToInternal(
                asaasFirstPayment.status as ASAASPaymentStatusEnum,
            );

            const dbPayment = await this.paymentRepository.create({
                id: 0,
                userId: data.userId,
                planId: plan.id,
                couponId: coupon?.id ?? null,
                amount: safeFinalAmount,
                status: internalStatus,
                paymentMethodId: paymentBillingType.toString(),
                paymentIdAsaas: asaasFirstPayment.id,
                paymentDate: startDate,
                dueAt: firstDueAt,
                createdAt: startDate,
                updatedAt: startDate,
                pixQrCode,
                pixPayload,
                installments: null,
                cashbackUsedAmount: pricing.cashbackPricing.cashbackUsed > 0 ? pricing.cashbackPricing.cashbackUsed : null,
            } as any);

            if (internalStatus === "PAID") {
                console.log("[createAsaasSubscription] 1ª mensalidade APROVADA IMEDIATAMENTE. Ativando assinatura local.");
                await this.updateSubscriptionValidityFromPayment(localSubscription, startDate, "PAID");
                return { subscription: localSubscription, payment: dbPayment };
            }

            return { subscription: localSubscription, payment: dbPayment };
        } catch (error) {
            console.error("[createAsaasSubscription] Erro fatal no fluxo:", error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Erro interno ao processar assinatura recorrente", 500);
        }
    }

    // ---------------------------------------------------------------------
    // Webhook de assinatura ASAAS
    // ---------------------------------------------------------------------

    public async handleSubscriptionWebhook(
        body: ASAASWebhookEvent,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void | { status: number; message: string }> {
        const subscriptionAsaasId = body.subscription?.id;
        if (!subscriptionAsaasId) {
            return;
        }

        const event = body.event;

        const localSubscriptionByAsaasRaw = await this.subscriptionRepository.getByAsaasId(subscriptionAsaasId);
        const localSubscriptionByAsaas = localSubscriptionByAsaasRaw
            ? this.hydrateSubscription(localSubscriptionByAsaasRaw)
            : null;

        if (!localSubscriptionByAsaas && event !== ASAASWebhookEventEnum.SUBSCRIPTION_CREATED) {
            console.log(`[handleSubscriptionWebhook] Assinatura ${subscriptionAsaasId} não encontrada localmente.`);
            return;
        }

        if (event === ASAASWebhookEventEnum.SUBSCRIPTION_CREATED && body.subscription) {
            console.info(`[handleSubscriptionWebhook] SUBSCRIPTION_CREATED ${body.subscription.id}`);

            const externalReferenceRaw = body.subscription.externalReference ?? "";

            const parsed = externalReferenceRaw
                ? PaymentPolicy.parseAsaasExternalReference(externalReferenceRaw)
                : null;

            const externalReferenceUserId = parsed?.userId;
            const externalReferencePlanId = parsed?.planId;
            const externalReferenceCouponId = parsed?.couponId;
            const externalReferenceSubId = parsed?.subId;

            if (!externalReferenceUserId || !externalReferencePlanId) {
                console.error("[handleSubscriptionWebhook] userId ou planId ausentes na referência externa.");
                return { status: 400, message: "Referência externa inválida na assinatura" };
            }

            const plan = await this.planRepository.findById(externalReferencePlanId);
            if (!plan) {
                console.error(
                    `[handleSubscriptionWebhook] Plano ${externalReferencePlanId} não encontrado ao processar SUBSCRIPTION_CREATED.`,
                );
                return { status: 400, message: "Plano da assinatura não encontrado" };
            }

            if (externalReferenceSubId !== undefined && externalReferenceSubId !== null) {
                const localByIdRaw = await this.subscriptionRepository.findById(externalReferenceSubId);

                if (localByIdRaw) {
                    const localById = this.hydrateSubscription(localByIdRaw);

                    localById.subscriptionIdAsaas = body.subscription.id;
                    localById.amount = body.subscription.value;

                    if (body.subscription.billingType) {
                        localById.paymentMethod = body.subscription.billingType;
                    }

                    await this.subscriptionRepository.update(localById.id, localById);

                    console.info(
                        `[handleSubscriptionWebhook] Subscription local ${localById.id} atualizada com subscriptionIdAsaas=${body.subscription.id}.`,
                    );

                    return { status: 200, message: "Assinatura vinculada ao registro local existente" };
                }
            }

            const existingByAsaasRaw = await this.subscriptionRepository.getByAsaasId(body.subscription.id);
            if (existingByAsaasRaw) {
                console.info(
                    `[handleSubscriptionWebhook] Assinatura já existe no banco por asaasId: ${body.subscription.id}`,
                );
                return { status: 200, message: "Assinatura já registrada" };
            }

            const startDate = new Date();
            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            const newSubscription = new Subscription({
                userId: externalReferenceUserId,
                planId: externalReferencePlanId,
                planType: plan.periodicityType,
                amount: body.subscription.value,
                isActive: false,
                startDate,
                expiresAt,
                endDate: null,
                paymentMethod: body.subscription.billingType,
                subscriptionIdAsaas: body.subscription.id,
                couponId: externalReferenceCouponId ?? null,
                subscriptionStatus: "SUSPENDED",
            });

            await this.subscriptionRepository.create(newSubscription);

            console.info(
                `[handleSubscriptionWebhook] Assinatura criada via fallback (sem subId). asaasId=${body.subscription.id}`,
            );

            return { status: 200, message: "Assinatura registrada (fallback) aguardando pagamento" };
        }

        if (newStatus === "CANCELED" && localSubscriptionByAsaas) {
            localSubscriptionByAsaas.isActive = false;
            localSubscriptionByAsaas.subscriptionStatus = "CANCELED";
            localSubscriptionByAsaas.endDate = new Date();

            await this.subscriptionRepository.update(localSubscriptionByAsaas.id, localSubscriptionByAsaas);

            console.info(
                `[handleSubscriptionWebhook] Assinatura ${localSubscriptionByAsaas.id} desativada por cancelamento ASAAS.`,
            );
        }
    }
}
