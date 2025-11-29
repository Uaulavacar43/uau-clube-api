// src/modules/payment/PaymentService.ts

import type { Coupon } from "../../entities/Coupon";
import type { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import { Payment } from "../../entities/Payment";
import { PeriodicityType, type Plan } from "../../entities/Plan";
import { Subscription } from "../../entities/Subscription";
import { AppError } from "../../error/AppError";
import type { ICouponRepository } from "../../repositories/interfaces/ICouponRepository";
import type { IIndividualServicePurchaseRepository } from "../../repositories/interfaces/IIndividualServicePurchaseRepository";
import type { IPaymentRepository } from "../../repositories/interfaces/IPaymentRepository";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IWashServiceRepository } from "../../repositories/interfaces/IWashServiceRepository";
import { asaasGetOrCreateCustomerByCpfCnpj } from "../../utils/asaas/asaasCustomer";
import { ASAAS_EVENT_STATUS_MAP } from "../../utils/asaas/asaasEventMap";
import {
    asaasCreatePayment,
    asaasGetPayment,
    asaasGetPixQrCode,
} from "../../utils/asaas/asaasPayments";
import { asaasGetOrCreateRandomPixKey } from "../../utils/asaas/asaasPixKeys";
import {
    asaasCreateSubscription,
    asaasListSubscriptionPayments,
} from "../../utils/asaas/asaasSubscriptions";
import {
    ASAASPaymentBillingTypeEnum,
    ASAASPaymentStatusEnum,
} from "../../utils/asaas/types/paymentTypes";
import {
    type ASAASCreateSubscriptionDTO,
    ASAASSubscriptionBillingTypeEnum,
    ASAASSubscriptionCycleEnum,
} from "../../utils/asaas/types/subscriptionTypes";
import {
    ASAASWebhookEventEnum,
    type ASAASWebhookEvent,
} from "../../utils/asaas/types/webhookTypes";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";

/**
 * Serviço de Pagamentos / Assinaturas integrados ao ASAAS.
 *
 * Planos hoje:
 * - Pacotes (mensal, trimestral, semestral, anual etc.) = cobrança tipo “pacote fechado”:
 *   - Gera um pagamento no ASAAS (PIX ou cartão);
 *   - Webhook do ASAAS confirma e ativa o plano.
 *   - Diferença do mensal: é um pacote que vence em 30 dias (PeriodicityType.MONTH),
 *     cobrado à vista (sem parcelamento).
 *
 * Regras:
 * - Webhook do ASAAS:
 *   - Marca pagamento como PAID/PENDING/CANCELED;
 *   - Atualiza a assinatura (Subscription) conforme o plano;
 *   - Quando o pagamento é confirmado/recebido, a assinatura é atualizada e o pagamento
 *     local é marcado com o status correto.
 */
export class PaymentService {
    constructor(
        private readonly paymentRepository: IPaymentRepository,
        private readonly planRepository: IPlanRepository,
        private readonly userRepository: IUserRepository,
        private readonly couponRepository: ICouponRepository,
        private readonly subscriptionRepository: ISubscriptionRepository,
        private readonly washServiceRepository: IWashServiceRepository,
        private readonly individualServicePurchaseRepository: IIndividualServicePurchaseRepository,
        private readonly carRepository: IUserCarRepository,
    ) {}

    // ---------------------------------------------------------------------
    // Helpers internos de status / tipos de plano
    // ---------------------------------------------------------------------

    private mapAsaasPaymentStatusToInternal(
        status: ASAASPaymentStatusEnum,
    ): "PAID" | "PENDING" | "CANCELED" {
        switch (status) {
            case ASAASPaymentStatusEnum.CONFIRMED:
            case ASAASPaymentStatusEnum.RECEIVED:
            case ASAASPaymentStatusEnum.RECEIVED_IN_CASH:
                return "PAID";

            case ASAASPaymentStatusEnum.REFUNDED:
            case ASAASPaymentStatusEnum.CHARGEBACK_REQUESTED:
            case ASAASPaymentStatusEnum.CHARGEBACK_DISPUTE:
            case ASAASPaymentStatusEnum.AWAITING_CHARGEBACK_REVERSAL:
                return "CANCELED";

            default:
                return "PENDING";
        }
    }

    /**
     * Pacote fechado (mensal, trimestral, semestral, anual etc.).
     *
     * Todo plano marcado como isPackage é tratado como pacote:
     * - Mensal (PeriodicityType.MONTH): vence em 30 dias, cobrança à vista;
     * - Trimestral, semestral, anual: validade conforme periodicidade;
     * - A ativação é sempre feita via pagamento ASAAS (webhook + ajuste local).
     */
    private isClosedPackagePlan(plan: Plan): boolean {
        return plan.isPackage === true;
    }

    // ---------------------------------------------------------------------
    // Pagamento avulso (serviços individuais)
    // ---------------------------------------------------------------------

    public async createPayment(
        data: CreatePaymentDTO,
        userId: number,
    ): Promise<{
        payment: Payment;
        individualPurchases: IndividualServicePurchase[];
        services: { id: number; name: string; price: number }[];
        amount: number;
        asaasCustomer: { id: string };
        coupon: Coupon | null;
        lockedUser: { id: number };
    }> {
        const loggedUser = await this.userRepository.findById(userId);
        if (!loggedUser) {
            throw new AppError("Usuário não encontrado", 404);
        }

        const cpf =
            data.creditCardHolderInfo?.cpfCnpj ?? data.cpf ?? loggedUser.cpf;
        if (!cpf) {
            throw new AppError(
                "O CPF do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const services =
            await this.washServiceRepository.findManyByIds(data.washServices);
        if (services.length === 0) {
            throw new AppError("Nenhum serviço de lavagem foi encontrado", 404);
        }

        const coupon = await this.validateCoupon(
            data.coupon,
            undefined,
            data.washServices,
        );

        const amount = services.reduce(
            (total, service) => total + service.price,
            0,
        );

        const billingTypes = new Map<
            CreatePaymentDTO["type"],
            ASAASPaymentBillingTypeEnum
        >([
            ["pix", ASAASPaymentBillingTypeEnum.PIX],
            ["creditCard", ASAASPaymentBillingTypeEnum.CREDIT_CARD],
        ]);
        const billingType = billingTypes.get(data.type);
        if (!billingType) {
            throw new AppError("Tipo de pagamento inválido", 400);
        }

        const asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
            name: data.creditCardHolderInfo?.name ?? loggedUser.name,
            cpfCnpj: cpf,
            email: data.creditCardHolderInfo?.email ?? loggedUser.email,
            phone:
                data.creditCardHolderInfo?.phone ??
                loggedUser.phone ??
                undefined,
            notificationDisabled: true,
        });

        await asaasGetOrCreateRandomPixKey();

        const asaasPayment = await asaasCreatePayment({
            billingType,
            dueDate: new Date().toISOString().split("T")[0],
            value: amount,
            customer: asaasCustomer.id,
            description: `Pagamento serviços avulsos: ${services
                .map((s) => s.name)
                .join(", ")}`,
            externalReference: JSON.stringify({
                userId,
                couponId: coupon?.id,
            }),
            discount: !coupon
                ? undefined
                : {
                    value: coupon.discountValue,
                    type: coupon.discountType,
                },
            creditCard: data.creditCard,
            creditCardHolderInfo: data.creditCardHolderInfo,
        });

        let pixQrCode: string | null = null;
        let pixPayload: string | null = null;
        if (billingType === ASAASPaymentBillingTypeEnum.PIX) {
            console.log("[createPayment] Recuperando QR code PIX...");
            const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
            pixQrCode = asaasPixCode.encodedImage;
            pixPayload = asaasPixCode.payload;
            console.log({ pixQrCode, pixPayload });
            console.log("[createPayment] QR code PIX recuperado.");
        }

        const agora = new Date();

        const internalStatusFromAsaas = this.mapAsaasPaymentStatusToInternal(
            asaasPayment.status,
        );

        const payment = await this.paymentRepository.create({
            id: 0,
            userId,
            amount,
            paymentMethodId: billingType.toString(),
            status: internalStatusFromAsaas,
            couponId: coupon?.id ?? null,
            paymentDate: agora,
            pixQrCode,
            pixPayload,
            createdAt: agora,
            updatedAt: agora,
            paymentIdAsaas: asaasPayment.id,
            planId: null,
            installments: null,
        });

        const individualPurchases: IndividualServicePurchase[] = [];
        for (const service of services) {
            const individualPurchase =
                await this.individualServicePurchaseRepository.create({
                    id: null,
                    userId,
                    washServiceId: service.id,
                    purchaseDate: agora,
                    status: "PENDING",
                    createdAt: agora,
                    updatedAt: agora,
                    paymentId: payment.id,
                });

            individualPurchases.push(individualPurchase);
        }

        return {
            payment,
            individualPurchases,
            services,
            amount,
            asaasCustomer,
            coupon,
            lockedUser: { id: loggedUser.id },
        };
    }

    // ---------------------------------------------------------------------
    // Assinaturas (Planos em formato de pacote: mensal, trimestral, etc.)
    // ---------------------------------------------------------------------

    public async subscribeToPlan(
        data: CreateSubscriptionToPlanDTO,
        userId: number,
    ): Promise<{
        subscription: Subscription;
        payment: Payment | null;
        asaasPayment?: unknown;
    }> {
        console.log("[subscribeToPlan] Iniciando processo de pagamento...");

        const loggedUser = await this.userRepository.findById(userId);
        if (!loggedUser) {
            throw new AppError("Usuário não encontrado", 404);
        }

        const cpf =
            data.creditCardHolderInfo?.cpfCnpj ?? data.cpf ?? loggedUser.cpf;
        if (!cpf) {
            throw new AppError(
                "O CPF do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const plan = await this.planRepository.findById(data.plan_id);
        if (!plan) {
            throw new AppError("Plano não encontrado", 404);
        }

        const isClosedPackagePlan = this.isClosedPackagePlan(plan);

        console.log(
            "[subscribeToPlan] Tipo de plano detectado:",
            isClosedPackagePlan ? "PACOTE_FECHADO" : "PLANO_RECORRENTE_ASAAS",
        );

        const car = await this.carRepository.findById(data.carId);
        if (!car) {
            throw new AppError("Carro não encontrado", 404);
        }

        if (
            plan.periodicityType === PeriodicityType.MONTH &&
            data.installments &&
            data.installments > 1
        ) {
            throw new AppError(
                "O plano mensal é cobrado à vista e não permite parcelamento em múltiplas parcelas.",
                400,
            );
        }

        const coupon = await this.validateCoupon(data.coupon, plan.id);

        const hasSubscription = await this.carHasSubscription(
            car.licensePlate,
        );
        if (hasSubscription) {
            throw new AppError(
                "Este carro já tem assinatura, caso queira alterar o plano do carro, cancele a assinatura atual",
                400,
            );
        }

        const billingPaymentTypes = new Map<
            CreatePaymentDTO["type"],
            ASAASPaymentBillingTypeEnum
        >([
            ["pix", ASAASPaymentBillingTypeEnum.PIX],
            ["creditCard", ASAASPaymentBillingTypeEnum.CREDIT_CARD],
        ]);
        const billingPaymentType = billingPaymentTypes.get(data.type);
        if (!billingPaymentType) {
            throw new AppError("Tipo de pagamento inválido", 400);
        }

        const billingSubscriptionTypes = new Map<
            CreatePaymentDTO["type"],
            ASAASSubscriptionBillingTypeEnum
        >([
            ["pix", ASAASSubscriptionBillingTypeEnum.PIX],
            ["creditCard", ASAASSubscriptionBillingTypeEnum.CREDIT_CARD],
        ]);
        const billingSubscriptionType =
            billingSubscriptionTypes.get(data.type);
        if (!billingSubscriptionType) {
            throw new AppError("Tipo de pagamento inválido", 400);
        }

        console.log("[subscribeToPlan] Criando cliente no ASAAS...");
        const asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
            name: loggedUser.name,
            cpfCnpj: data.creditCardHolderInfo?.cpfCnpj ?? cpf,
            email: data.creditCardHolderInfo?.email ?? loggedUser.email,
            phone: data.creditCardHolderInfo?.phone ?? loggedUser.phone,
            postalCode: data.creditCardHolderInfo?.postalCode,
            addressNumber: data.creditCardHolderInfo?.addressNumber,
            mobilePhone:
                data.creditCardHolderInfo?.mobilePhone ??
                data.creditCardHolderInfo?.phone,
            notificationDisabled: false,
        });

        console.log("[subscribeToPlan] Criando assinatura em formato de PACOTE...");

        const is100PercentDiscount =
            coupon?.discountType === "PERCENTAGE"
                ? coupon.discountValue === 100
                : (coupon?.discountValue ?? 0) >= plan.price;

        const timeZoneOffset = data.timeZoneOffset ?? -180;
        const dateWithTimeZone = new Date();
        dateWithTimeZone.setMinutes(
            dateWithTimeZone.getMinutes() + timeZoneOffset,
        );

        if (is100PercentDiscount) {
            const expiresAt = this.calculatePlanExpiration(
                plan,
                dateWithTimeZone,
            );

            const subscription = await this.subscriptionRepository.create(
                new Subscription({
                    userId: loggedUser.id,
                    planId: plan.id,
                    planType: plan.periodicityType,
                    amount: plan.price,
                    isActive: true,
                    startDate: dateWithTimeZone,
                    carId: data.carId,
                    expiresAt,
                    paymentMethod: billingPaymentType,
                    couponId: coupon?.id ?? null,
                }),
            );

            const payment = await this.paymentRepository.create({
                id: 0,
                userId,
                planId: plan.id,
                amount: 0,
                status: "PAID",
                installments: null,
                paymentDate: dateWithTimeZone,
                createdAt: dateWithTimeZone,
                updatedAt: dateWithTimeZone,
                paymentIdAsaas: "Cupom cobriu o custo",
                couponId: coupon?.id ?? null,
                pixQrCode: null,
                pixPayload: null,
                paymentMethodId: billingPaymentType.toString(),
            });

            return { subscription, payment };
        }

        if (isClosedPackagePlan) {
            console.log(
                `[subscribeToPlan] Plano no formato PACOTE FECHADO, periodicidade: ${plan.periodicityType}`,
            );

            if (
                plan.periodicityType !== PeriodicityType.MONTH &&
                billingSubscriptionType ===
                ASAASSubscriptionBillingTypeEnum.CREDIT_CARD &&
                data.installments &&
                data.installments > 1
            ) {
                this.validatePlanInstallments(plan, data.installments);
            }

            const expiresAt = this.calculatePlanExpiration(
                plan,
                dateWithTimeZone,
            );

            const subscription = await this.subscriptionRepository.create(
                new Subscription({
                    userId: loggedUser.id,
                    planId: plan.id,
                    planType: plan.periodicityType,
                    amount: plan.price,
                    isActive: false,
                    startDate: dateWithTimeZone,
                    carId: data.carId,
                    expiresAt,
                    paymentMethod: billingPaymentType,
                    couponId: coupon?.id ?? null,
                }),
            );

            const asaasPayment = await asaasCreatePayment({
                billingType: billingPaymentType,
                dueDate: dateWithTimeZone.toISOString().split("T")[0],
                value: plan.price,
                installmentCount:
                    plan.periodicityType !== PeriodicityType.MONTH &&
                    data.installments &&
                    data.installments > 1
                        ? data.installments
                        : undefined,
                totalValue:
                    plan.periodicityType !== PeriodicityType.MONTH &&
                    data.installments &&
                    data.installments > 1
                        ? plan.price
                        : undefined,
                customer: asaasCustomer.id,
                description: `Pagamento plano no formato PACOTE: ${plan.name}`,
                externalReference: JSON.stringify({
                    userId,
                    couponId: coupon?.id,
                    planId: plan.id,
                    subId: subscription.id,
                }),
                discount: !coupon
                    ? undefined
                    : {
                        value: coupon.discountValue,
                        type: coupon.discountType,
                    },
                creditCard: data.creditCard,
                creditCardHolderInfo: data.creditCardHolderInfo,
            });

            subscription.installmentIdAsaas = asaasPayment.installment
                ? asaasPayment.installment
                : null;

            const finalStatus = this.mapAsaasPaymentStatusToInternal(
                asaasPayment.status as ASAASPaymentStatusEnum,
            );

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;

            if (billingPaymentType === ASAASPaymentBillingTypeEnum.PIX) {
                console.log(
                    "[subscribeToPlan] Recuperando QR code PIX para PACOTE FECHADO...",
                );
                const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log({ pixQrCode, pixPayload });
                console.log("[subscribeToPlan] QR code PIX recuperado.");
            }

            const payment = await this.paymentRepository.create({
                id: 0,
                userId,
                planId: plan.id,
                amount: plan.price,
                status: finalStatus,
                installments:
                    plan.periodicityType !== PeriodicityType.MONTH
                        ? data.installments ?? null
                        : null,
                paymentDate: dateWithTimeZone,
                createdAt: dateWithTimeZone,
                updatedAt: dateWithTimeZone,
                paymentIdAsaas: asaasPayment.id,
                couponId: coupon?.id ?? null,
                pixQrCode,
                pixPayload,
                paymentMethodId: billingPaymentType.toString(),
            });

            let createdSubscription: Subscription;

            if (finalStatus === "PAID") {
                await this.updateSubscriptionValidityFromPayment(
                    subscription,
                    dateWithTimeZone,
                    "PAID",
                );
                createdSubscription = subscription;
            } else {
                createdSubscription =
                    await this.subscriptionRepository.update(
                        subscription.id,
                        subscription,
                    );
            }

            return {
                subscription: createdSubscription,
                payment,
                asaasPayment,
            };
        }

        console.log(
            "[subscribeToPlan] Plano NÃO é pacote. Criando assinatura ASAAS recorrente...",
        );

        const { subscription, payment } = await this.createAsaasSubscription(
            {
                ...data,
                userId,
            },
            plan,
            asaasCustomer.id,
            coupon,
            billingSubscriptionType,
        );

        if (!subscription) {
            throw new AppError("Falha ao criar assinatura", 400);
        }

        console.log(
            "[subscribeToPlan] Assinatura criada no ASAAS (recorrente):",
            subscription.subscriptionIdAsaas ?? "(sem subscriptionIdAsaas)",
        );

        return {
            subscription: subscription as Subscription,
            payment,
        };
    }

    // ---------------------------------------------------------------------
    // Validações de cupom / parcelas
    // ---------------------------------------------------------------------

    private async validateCoupon(
        code?: string,
        planId?: number,
        serviceIds?: number[],
    ): Promise<Coupon | null> {
        if (!code) {
            return null;
        }

        const coupon = await this.couponRepository.findByCode(code);
        if (!coupon) {
            throw new AppError("Cupom inválido", 404);
        }

        if (!coupon.isActive) {
            throw new AppError("Cupom inválido", 400);
        }
        if (this.couponRepository.isExpired(coupon)) {
            throw new AppError("Cupom inválido", 400);
        }
        if (this.couponRepository.isNotStarted(coupon)) {
            throw new AppError("Cupom inválido", 400);
        }
        if (this.couponRepository.hasReachedUsageLimit(coupon)) {
            throw new AppError("Cupom inválido", 400);
        }

        const hasPlansRelation = (coupon.plans?.length ?? 0) > 0;
        if (
            hasPlansRelation &&
            planId &&
            !coupon.plans?.some((planItem) => planItem.id === planId)
        ) {
            throw new AppError("Cupom inválido", 400);
        }

        const hasServicesRelation = (coupon.services?.length ?? 0) > 0;
        if (
            hasServicesRelation &&
            serviceIds &&
            !coupon.services?.some((service) => serviceIds.includes(service.id))
        ) {
            throw new AppError("Cupom inválido", 400);
        }

        return coupon;
    }

    private validatePlanInstallments(plan: Plan, installments?: number): true {
        if (!installments || installments <= 1) {
            return true;
        }

        const maxInstallments = plan.maxInstallments ?? 0;

        if (maxInstallments <= 0) {
            throw new AppError("Este plano não permite parcelamento", 400);
        }

        if (installments > maxInstallments) {
            throw new AppError(
                `Este plano permite parcelamento em até ${maxInstallments}x`,
                400,
            );
        }

        if (
            plan.periodicityType === PeriodicityType.YEAR &&
            installments > 12
        ) {
            throw new AppError(
                "O plano anual não pode ter mais de 12 parcelas",
                400,
            );
        }

        if (
            plan.periodicityType === PeriodicityType.QUARTERLY &&
            installments > 3
        ) {
            throw new AppError(
                "O plano trimestral não pode ter mais de 3 parcelas",
                400,
            );
        }

        if (
            plan.periodicityType === PeriodicityType.SEMIANNUALLY &&
            installments > 6
        ) {
            throw new AppError(
                "O plano semestral não pode ter mais de 6 parcelas",
                400,
            );
        }

        return true;
    }

    // ---------------------------------------------------------------------
    // Webhook ASAAS
    // ---------------------------------------------------------------------

    private mapEventToInternalStatus(
        event: ASAASWebhookEventEnum,
    ): "PAID" | "PENDING" | "CANCELED" | undefined {
        switch (event) {
            case ASAASWebhookEventEnum.PAYMENT_CONFIRMED:
            case ASAASWebhookEventEnum.PAYMENT_RECEIVED:
                return "PAID";
            case ASAASWebhookEventEnum.PAYMENT_CREATED:
            case ASAASWebhookEventEnum.PAYMENT_UPDATED:
            case ASAASWebhookEventEnum.PAYMENT_OVERDUE:
                return "PENDING";
            case ASAASWebhookEventEnum.PAYMENT_DELETED:
            case ASAASWebhookEventEnum.PAYMENT_REFUNDED:
            case ASAASWebhookEventEnum.PAYMENT_RECEIVED_IN_CASH_UNDONE:
                return "CANCELED";
            default:
                return undefined;
        }
    }

    private resolveInternalStatus(
        event: ASAASWebhookEventEnum,
    ): "PAID" | "PENDING" | "CANCELED" | undefined {
        const mapped = ASAAS_EVENT_STATUS_MAP[event];
        if (mapped) {
            return mapped;
        }
        return this.mapEventToInternalStatus(event);
    }

    public async paymentWebhook(body: ASAASWebhookEvent): Promise<{
        status: number;
        message: string;
        newStatus?: "PAID" | "PENDING" | "CANCELED";
        error?: unknown;
    }> {
        try {
            console.info(
                "[paymentWebhook] Webhook recebido:",
                JSON.stringify(body, null, 2),
            );

            const { event } = body;
            if (!event) {
                console.warn(
                    "[paymentWebhook] Nenhum evento no corpo da requisição.",
                );
                return {
                    status: 200,
                    message: "Nenhum evento encontrado no webhook do ASAAS",
                };
            }

            const newStatus = this.resolveInternalStatus(event);

            if (!newStatus) {
                console.warn("[paymentWebhook] Evento não tratado:", event);
                return {
                    status: 200,
                    message: `Evento não processado: ${event}`,
                };
            }

            if (body.subscription?.id) {
                await this.handleSubscriptionWebhook(body, newStatus);
            }

            if (body.payment?.id) {
                await this.handlePaymentWebhook(body, newStatus);
            }

            return {
                status: 200,
                message: "Webhook processado com sucesso",
                newStatus,
            };
        } catch (error) {
            console.error("[paymentWebhook] Erro inesperado:", error);
            return { status: 200, message: "Erro interno", error };
        }
    }

    private async carHasSubscription(licensePlate: string): Promise<boolean> {
        const existingSubscription =
            await this.subscriptionRepository.findByCarLicensePlate(
                licensePlate,
            );
        if (!existingSubscription || !existingSubscription.isActive) {
            return false;
        }

        return true;
    }

    private async createAsaasSubscription(
        data: CreateSubscriptionToPlanDTO & { userId: number },
        plan: Plan,
        customerId: string,
        coupon: Coupon | null,
        billingType: ASAASSubscriptionBillingTypeEnum,
    ): Promise<{
        subscription: Subscription;
        payment: Payment | null;
    }> {
        try {
            const mapCycle = new Map<
                PeriodicityType,
                ASAASSubscriptionCycleEnum
            >([
                [PeriodicityType.WEEK, ASAASSubscriptionCycleEnum.WEEKLY],
                [PeriodicityType.MONTH, ASAASSubscriptionCycleEnum.MONTHLY],
                [
                    PeriodicityType.QUARTERLY,
                    ASAASSubscriptionCycleEnum.QUARTERLY,
                ],
                [
                    PeriodicityType.SEMIANNUALLY,
                    ASAASSubscriptionCycleEnum.SEMIANNUALLY,
                ],
                [PeriodicityType.YEAR, ASAASSubscriptionCycleEnum.YEARLY],
            ]);

            const cycle = mapCycle.get(plan.periodicityType);
            if (!cycle) {
                throw new AppError(
                    `Este período de assinatura não existe ou não é permitido neste formato: ${plan.periodicityType}`,
                    400,
                );
            }

            const timeZoneOffset = data.timeZoneOffset ?? -180;
            const startDate = new Date();
            startDate.setMinutes(startDate.getMinutes() + timeZoneOffset);

            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            const localSubscription =
                await this.subscriptionRepository.create(
                    new Subscription({
                        userId: data.userId,
                        planId: plan.id,
                        planType: plan.periodicityType,
                        amount: plan.price,
                        isActive: false,
                        startDate,
                        carId: data.carId,
                        paymentMethod: billingType,
                        subscriptionIdAsaas: null,
                        couponId: coupon?.id ?? null,
                        expiresAt,
                    }),
                );

            const payload: ASAASCreateSubscriptionDTO = {
                customer: customerId,
                nextDueDate: new Date().toISOString().split("T")[0],
                value: plan.price,
                billingType,
                cycle,
                description: `Plano recorrente: ${plan.name}`,
                externalReference: JSON.stringify({
                    userId: data.userId,
                    planId: plan.id,
                    couponId: coupon?.id,
                    subId: localSubscription.id,
                }),
                creditCard: data.creditCard,
                creditCardHolderInfo: data.creditCardHolderInfo,
                discount: !coupon
                    ? undefined
                    : {
                        value: coupon.discountValue,
                        type: coupon.discountType,
                    },
            };

            console.log(
                "[createAsaasSubscription] Criando assinatura no Asaas...",
            );
            const asaasSubscription = await asaasCreateSubscription(
                payload,
                customerId,
            );

            localSubscription.subscriptionIdAsaas = asaasSubscription.id;
            localSubscription.amount = asaasSubscription.value;
            await this.subscriptionRepository.update(
                localSubscription.id,
                localSubscription,
            );
            console.log(
                `[createAsaasSubscription] Assinatura Asaas ${asaasSubscription.id} vinculada ao ID local ${localSubscription.id}.`,
            );

            console.log(
                "[createAsaasSubscription] Tentando recuperar a primeira cobrança (ID pay_...).",
            );
            const paymentList = await asaasListSubscriptionPayments(
                asaasSubscription.id,
            );

            const firstPaymentAsaas = paymentList.data[0];

            if (!firstPaymentAsaas) {
                console.warn(
                    "[createAsaasSubscription] ALERTA: Cobrança não encontrada imediatamente. O Webhook irá criar o registro de Payment e ativar o PIX/Cartão.",
                );

                return {
                    subscription: localSubscription,
                    payment: null,
                };
            }

            console.log(
                `[createAsaasSubscription] Cobrança recuperada: ${firstPaymentAsaas.id} (Status: ${firstPaymentAsaas.status})`,
            );

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;

            if (billingType === ASAASSubscriptionBillingTypeEnum.PIX) {
                console.log(
                    "[createAsaasSubscription] Recuperando QR code PIX...",
                );
                const asaasPixCode = await asaasGetPixQrCode(
                    firstPaymentAsaas.id,
                );
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log(
                    "[createAsaasSubscription] QR code PIX recuperado e pronto para o cliente.",
                );
            }

            const internalStatus = this.mapAsaasPaymentStatusToInternal(
                firstPaymentAsaas.status as ASAASPaymentStatusEnum,
            );

            const dbPayment = await this.paymentRepository.create({
                id: 0,
                userId: data.userId,
                planId: plan.id,
                couponId: coupon?.id ?? null,
                amount: plan.price,
                status: internalStatus,
                paymentMethodId: billingType.toString(),
                paymentIdAsaas: firstPaymentAsaas.id,
                paymentDate: startDate,
                createdAt: startDate,
                updatedAt: startDate,
                pixQrCode,
                pixPayload,
                installments: null,
            });

            if (internalStatus === "PAID") {
                console.log(
                    "[createAsaasSubscription] Pagamento APROVADO IMEDIATAMENTE. Ativando assinatura local.",
                );
                await this.updateSubscriptionValidityFromPayment(
                    localSubscription,
                    startDate,
                    "PAID",
                );
                return {
                    subscription: localSubscription,
                    payment: dbPayment,
                };
            }

            return {
                subscription: localSubscription,
                payment: dbPayment,
            };
        } catch (error) {
            console.error(
                "[createAsaasSubscription] Erro fatal no fluxo:",
                error,
            );
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(
                "Erro interno ao processar assinatura recorrente",
                500,
            );
        }
    }

    private async handleSubscriptionWebhook(
        body: ASAASWebhookEvent,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void | { status: number; message: string }> {
        const subscriptionAsaasId = body.subscription?.id;
        if (!subscriptionAsaasId) {
            return;
        }

        const localSubscription =
            await this.subscriptionRepository.getByAsaasId(
                subscriptionAsaasId,
            );
        if (
            !localSubscription &&
            body.event !== ASAASWebhookEventEnum.SUBSCRIPTION_CREATED
        ) {
            console.log(
                `[handleSubscriptionWebhook] Assinatura ${subscriptionAsaasId} não encontrada localmente.`,
            );
            return;
        }

        if (
            body.event === ASAASWebhookEventEnum.SUBSCRIPTION_CREATED &&
            body.subscription
        ) {
            console.info(
                `[handleSubscriptionWebhook] SUBSCRIPTION_CREATED ${body.subscription.id}`,
            );

            const externalReferenceRaw =
                body.subscription.externalReference ?? "";
            let externalReferenceUserId: number | undefined;
            let externalReferencePlanId: number | undefined;
            let externalReferenceCouponId: number | undefined;

            if (externalReferenceRaw) {
                try {
                    const externalReference = JSON.parse(
                        externalReferenceRaw,
                    ) as {
                        userId?: number;
                        planId?: number;
                        couponId?: number;
                    };
                    externalReferenceUserId = externalReference.userId;
                    externalReferencePlanId = externalReference.planId;
                    externalReferenceCouponId = externalReference.couponId;
                } catch (parseError) {
                    console.error(
                        "[handleSubscriptionWebhook] Erro ao fazer parse da externalReference:",
                        parseError,
                    );
                }
            }

            if (!externalReferenceUserId || !externalReferencePlanId) {
                console.error(
                    "[handleSubscriptionWebhook] userId ou planId ausentes na referência externa.",
                );
                return {
                    status: 400,
                    message: "Referência externa inválida na assinatura",
                };
            }

            const existingSubscription =
                await this.subscriptionRepository.getByAsaasId(
                    body.subscription.id,
                );
            if (existingSubscription) {
                console.info(
                    `[handleSubscriptionWebhook] Assinatura já existe no banco: ${body.subscription.id}`,
                );
                return {
                    status: 200,
                    message: "Assinatura já registrada",
                };
            }

            console.info(
                `[handleSubscriptionWebhook] Registrando assinatura (inativa até pagamento) para userId: ${externalReferenceUserId}, planId: ${externalReferencePlanId}`,
            );

            const newSubscription = new Subscription({
                userId: externalReferenceUserId,
                planId: externalReferencePlanId,
                planType: body.subscription.cycle,
                amount: body.subscription.value,
                isActive: false,
                startDate: new Date(),
                endDate: undefined,
                paymentMethod: body.subscription.billingType,
                subscriptionIdAsaas: body.subscription.id,
                couponId: externalReferenceCouponId ?? null,
            });

            await this.subscriptionRepository.create(newSubscription);
            console.info(
                `[handleSubscriptionWebhook] Assinatura salva como INATIVA. Ativação depende de pagamento.`,
            );

            return {
                status: 200,
                message: "Assinatura registrado (aguardando pagamento)",
            };
        }

        if (newStatus === "CANCELED" && localSubscription) {
            localSubscription.isActive = false;
            await this.subscriptionRepository.update(
                localSubscription.id,
                localSubscription,
            );
            console.info(
                `[handleSubscriptionWebhook] Assinatura ${localSubscription.id} desativada por evento de cancelamento.`,
            );
        }
    }

    private async handlePaymentWebhook(
        body: ASAASWebhookEvent,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<{
        status: number;
        message: string;
        newStatus?: "PAID" | "PENDING" | "CANCELED";
        error?: unknown;
    }> {
        try {
            console.log(
                "[handlePaymentWebhook] Processando webhook de pagamento...",
            );

            if (!body.payment) {
                console.warn(
                    "[handlePaymentWebhook] body.payment está indefinido",
                );
                return { status: 200, message: "Sem dados de pagamento" };
            }

            const paymentAsaasId = body.payment.id;
            if (!paymentAsaasId) {
                console.warn(
                    "[handlePaymentWebhook] payment.id está indefinido",
                );
                return {
                    status: 200,
                    message: "ID de pagamento não encontrado",
                };
            }

            const amount = Number(body.payment.value) || 0;

            const paymentDate =
                body.payment.paymentDate !== undefined &&
                body.payment.paymentDate !== null
                    ? new Date(body.payment.paymentDate)
                    : new Date();

            let userId: number | undefined;
            let planId: number | undefined;
            let couponId: number | undefined;
            let subId: number | undefined;

            if (body.payment.externalReference) {
                try {
                    const externalReference = JSON.parse(
                        body.payment.externalReference,
                    ) as {
                        userId?: number;
                        planId?: number;
                        couponId?: number;
                        subId?: number;
                    };

                    userId = externalReference.userId;
                    planId = externalReference.planId;
                    couponId = externalReference.couponId;
                    subId = externalReference.subId;
                } catch (parseError) {
                    console.error(
                        "[handlePaymentWebhook] Erro ao fazer parse da externalReference:",
                        parseError,
                    );
                }
            }

            console.log(
                `[handlePaymentWebhook] userId inicial: ${userId}, planId inicial: ${planId}, couponId inicial: ${couponId}`,
            );

            if (!userId && body.payment.subscription) {
                console.log(
                    "[handlePaymentWebhook] Procurando usuário a partir da assinatura local...",
                );
                const localSub =
                    await this.subscriptionRepository.getByAsaasId(
                        body.payment.subscription,
                    );
                if (localSub) {
                    userId = localSub.userId;
                    planId = localSub.planId;
                    subId = localSub.id;
                }
            }

            if (subId) {
                const subscriptionFromId =
                    await this.subscriptionRepository.findById(subId);
                if (subscriptionFromId) {
                    userId = subscriptionFromId.userId;
                    planId = subscriptionFromId.planId;
                    subId = subscriptionFromId.id;
                }
            }

            if (userId) {
                const userExists = await this.userRepository.findById(userId);
                if (!userExists) {
                    console.error(
                        `[handlePaymentWebhook] Usuário ID ${userId} não encontrado. Pulando inserção de pagamento.`,
                    );
                    return {
                        status: 200,
                        message: `Usuário ID ${userId} não encontrado`,
                    };
                }
            } else {
                console.warn(
                    "[handlePaymentWebhook] userId é 0 ou nulo. Pulando inserção de pagamento.",
                );
                return {
                    status: 200,
                    message:
                        "Nenhum userId encontrado para associar o pagamento",
                };
            }

            if (planId) {
                const planExists = await this.planRepository.findById(planId);
                if (!planExists) {
                    console.error(
                        `[handlePaymentWebhook] Plano ID ${planId} não encontrado. Pulando inserção.`,
                    );
                    return {
                        status: 200,
                        message: `Plano ID ${planId} não encontrado`,
                    };
                }
            }

            if (couponId) {
                const couponExists =
                    await this.couponRepository.findById(couponId);
                if (!couponExists) {
                    console.error(
                        `[handlePaymentWebhook] Cupom ID ${couponId} não encontrado. Pulando inserção.`,
                    );
                    return {
                        status: 200,
                        message: `Cupom ID ${couponId} não encontrado`,
                    };
                }
            }

            const existingPayment =
                await this.paymentRepository.getByAsaasId(paymentAsaasId);

            console.log(
                `[handlePaymentWebhook] ${
                    existingPayment ? "Atualizando" : "Registrando"
                } pagamento => userId: ${userId}, planId: ${planId}, couponId: ${
                    couponId ?? null
                }, amount: ${amount}, status: ${newStatus}`,
            );

            const paymentMethodIdFromBody =
                body.payment.billingType ?? null;

            const paymentMethodId =
                paymentMethodIdFromBody ??
                existingPayment?.paymentMethodId ??
                null;

            const ensuredUserId = userId as number;
            const normalizedPlanId = planId ?? null;
            const normalizedCouponId = couponId ?? null;

            const newPayment = new Payment({
                userId: ensuredUserId,
                planId: normalizedPlanId,
                couponId: normalizedCouponId,
                amount,
                status: newStatus,
                paymentDate,
                paymentIdAsaas: paymentAsaasId,
                paymentMethodId,
            });

            if (existingPayment) {
                await this.paymentRepository.update(
                    { id: existingPayment.id },
                    newPayment,
                    true,
                );
            } else {
                await this.paymentRepository.create(newPayment);
            }

            if (body.payment.subscription || subId) {
                let subscription: Subscription | null = null;

                if (body.payment.subscription) {
                    subscription =
                        await this.subscriptionRepository.getByAsaasId(
                            body.payment.subscription,
                        );
                }

                if (subId && !subscription) {
                    subscription =
                        await this.subscriptionRepository.findById(subId);
                }

                if (subscription) {
                    await this.updateSubscriptionValidityFromPayment(
                        subscription,
                        paymentDate,
                        newStatus,
                    );
                }
            }

            if (body.payment.installment) {
                const subscription =
                    await this.subscriptionRepository.getByInstallmentIdAsaas(
                        body.payment.installment,
                    );
                if (subscription) {
                    await this.updateSubscriptionValidityFromPayment(
                        subscription,
                        paymentDate,
                        newStatus,
                    );
                }
            }

            console.log(
                `[handlePaymentWebhook] Pagamento armazenado com sucesso: ${paymentAsaasId}`,
            );

            return {
                status: 200,
                message: "Pagamento processado com sucesso",
                newStatus,
            };
        } catch (error) {
            console.error("[handlePaymentWebhook] Erro inesperado:", error);
            return { status: 200, message: "Erro interno", error };
        }
    }

    // ---------------------------------------------------------------------
    // Helpers de plano / assinatura
    // ---------------------------------------------------------------------

    private calculatePlanExpiration(plan: Plan, referenceDate: Date): Date {
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

        if (
            plan.extraMonths !== undefined &&
            plan.extraMonths !== null &&
            plan.extraMonths > 0
        ) {
            baseDate.setMonth(baseDate.getMonth() + plan.extraMonths);
        }

        return baseDate;
    }

    private async updateSubscriptionValidityFromPayment(
        subscription: Subscription,
        paymentDate: Date,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void> {
        if (newStatus === "CANCELED") {
            subscription.isActive = false;
            await this.subscriptionRepository.update(
                subscription.id,
                subscription,
            );
            console.log(
                `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} desativada por status CANCELED.`,
            );
            return;
        }

        if (newStatus !== "PAID") {
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

        const hasFutureExpiration =
            subscription.expiresAt !== undefined &&
            subscription.expiresAt !== null &&
            subscription.expiresAt.getTime() > paymentDate.getTime();

        const referenceBase = hasFutureExpiration
            ? (subscription.expiresAt as Date)
            : paymentDate;

        const expiresAt = this.calculatePlanExpiration(plan, referenceBase);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        if (!subscription.startDate) {
            subscription.startDate = paymentDate;
        }

        subscription.expiresAt = expiresAt;
        subscription.isActive = isActive;

        await this.subscriptionRepository.update(
            subscription.id,
            subscription,
        );

        console.log(
            `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} atualizada => isActive: ${isActive}, startDate: ${subscription.startDate.toISOString()}, expiresAt: ${subscription.expiresAt?.toISOString()}`,
        );
    }

    // ---------------------------------------------------------------------
    // Relatórios / estatísticas
    // ---------------------------------------------------------------------

    public async getMonthlyRevenueHistory() {
        return this.paymentRepository.getMonthlyRevenueHistory();
    }

    public async getYearlyRevenueHistory() {
        return this.paymentRepository.getYearlyRevenueHistory();
    }

    public async updatePaymentStatus(
        paymentId: number,
        status: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void> {
        await this.paymentRepository.updatePaymentStatus(paymentId, status);
    }

    public async getTotalRevenue() {
        return this.paymentRepository.getTotalRevenue();
    }

    public async getCurrentMonthRevenue() {
        return this.paymentRepository.getCurrentMonthRevenue();
    }

    public async getNextMonthPredictedRevenue() {
        return this.paymentRepository.getNextMonthPredictedRevenue();
    }

    public async getAllPaymentsWithDetails(data: GetAllPaymentsWithDetailsDTO) {
        return this.paymentRepository.getAllPaymentsWithDetails(data);
    }

    private async syncPaymentWithAsaasByLocalId(
        paymentId: number,
    ): Promise<void> {
        const localPayment = await this.paymentRepository.getOneByFilter({
            id: paymentId,
        });

        if (!localPayment) {
            console.warn(
                `[syncPaymentWithAsaasByLocalId] Pagamento local ${paymentId} não encontrado.`,
            );
            return;
        }

        if (!localPayment.paymentIdAsaas) {
            console.warn(
                `[syncPaymentWithAsaasByLocalId] Pagamento ${paymentId} sem paymentIdAsaas. Nada para sincronizar via consulta direta ao ASAAS.`,
            );
            return;
        }

        if (
            localPayment.status === "PAID" ||
            localPayment.status === "CANCELED"
        ) {
            return;
        }

        try {
            const asaasPayment = await asaasGetPayment(
                localPayment.paymentIdAsaas,
            );

            const internalStatusFromAsaas =
                this.mapAsaasPaymentStatusToInternal(
                    asaasPayment.status as ASAASPaymentStatusEnum,
                );

            if (internalStatusFromAsaas !== localPayment.status) {
                console.log(
                    `[syncPaymentWithAsaasByLocalId] Atualizando status do pagamento ${paymentId} de ${localPayment.status} para ${internalStatusFromAsaas} com base no ASAAS.`,
                );
                await this.paymentRepository.updatePaymentStatus(
                    localPayment.id,
                    internalStatusFromAsaas,
                );
            }
        } catch (error) {
            console.error(
                "[syncPaymentWithAsaasByLocalId] Erro ao consultar pagamento no ASAAS:",
                error,
            );
        }
    }

    public async getPaymentDetailsById(paymentId: number) {
        await this.syncPaymentWithAsaasByLocalId(paymentId);
        return this.paymentRepository.getPaymentDetailsById(paymentId);
    }

    public async getMRR() {
        return this.paymentRepository.getMRR();
    }
}
