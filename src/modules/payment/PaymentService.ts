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
import type { ASAASWebhookEvent } from "../../utils/asaas/types/webhookTypes";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";

/**
 * PaymentService que:
 * - Cria/atualiza um Cliente no ASAAS
 * - Configura uma Assinatura com cobrança imediata
 * - Trata eventos de webhook do ASAAS para pagamentos e assinaturas
 * - Persiste entradas de Pagamentos locais
 */
export class PaymentService {
    constructor(
        private paymentRepository: IPaymentRepository,
        private planRepository: IPlanRepository,
        private userRepository: IUserRepository,
        private couponRepository: ICouponRepository,
        private subscriptionRepository: ISubscriptionRepository,
        private washServiceRepository: IWashServiceRepository,
        private individualServicePurchaseRepository: IIndividualServicePurchaseRepository,
        private carRepository: IUserCarRepository,
    ) {}

    public async createPayment(data: CreatePaymentDTO, userId: number) {
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

        const services = await this.washServiceRepository.findManyByIds(
            data.washServices,
        );
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
            console.log({
                pixQrCode,
                pixPayload,
            });
            console.log("[createPayment] QR code PIX recuperado.");
        }

        const agora = new Date();

        const payment = await this.paymentRepository.create({
            id: 0,
            userId,
            amount,
            paymentMethodId: billingType.toString(),
            status: "PENDING",
            couponId: coupon?.id,
            paymentDate: agora,
            pixQrCode,
            pixPayload,
            createdAt: agora,
            updatedAt: agora,
            paymentIdAsaas: asaasPayment.id,
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
            lockedUser: loggedUser,
        };
    }

    /**
     * Cria uma assinatura no ASAAS (mensal ou pacote) e
     * um Pagamento local com status "PENDENTE" (embora a cobrança imediata seja acionada).
     *
     * Regra de negócio dos planos:
     * - Mensal: recorrente, NÃO tem parcelamento em N vezes (uma cobrança por ciclo).
     * - Trimestral: pacote, permite parcelar em ATÉ 3x (maxInstallments = 3).
     * - Anual: pacote, permite parcelar em ATÉ 12x (maxInstallments = 12).
     */
    public async subscribeToPlan(
        data: CreateSubscriptionToPlanDTO,
        userId: number,
    ) {
        console.log("[createPayment] Iniciando processo de pagamento...");

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

        if (
            !plan.isPackage &&
            plan.periodicityType === PeriodicityType.MONTH &&
            data.installments &&
            data.installments > 1
        ) {
            throw new AppError(
                "Este plano é mensal recorrente e não permite parcelamento em múltiplas parcelas. A cobrança é feita mês a mês.",
                400,
            );
        }

        const car = await this.carRepository.findById(data.carId);
        if (!car) {
            throw new AppError("Carro não encontrado", 404);
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

        console.log("[createPayment] Criando cliente no ASAAS...");
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

        console.log("[createPayment] Criando assinatura no ASAAS...");

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
                    couponId: coupon?.id,
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
                couponId: coupon?.id,
                pixQrCode: null,
                pixPayload: null,
            });

            return {
                subscription,
                payment,
            };
        }

        if (plan.isPackage) {
            console.log(
                `[createPayment] Plano no formato pacote, periodicidade: ${plan.periodicityType}`,
            );

            if (
                !data.installments &&
                billingSubscriptionType ===
                ASAASSubscriptionBillingTypeEnum.CREDIT_CARD
            ) {
                throw new AppError(
                    "O número de parcelas deve ser informado",
                    400,
                );
            }

            this.validatePlanInstallments(plan, data.installments);

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
                    couponId: coupon?.id,
                }),
            );

            const asaasPayment = await asaasCreatePayment({
                billingType: billingPaymentType,
                dueDate: dateWithTimeZone.toISOString().split("T")[0],
                value: plan.price,
                installmentCount:
                    data.installments && data.installments > 1
                        ? data.installments
                        : undefined,
                totalValue:
                    data.installments && data.installments > 1
                        ? plan.price
                        : undefined,
                customer: asaasCustomer.id,
                description: `Pagamento plano no formato pacote: ${plan.name}`,
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

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;
            if (billingPaymentType === ASAASPaymentBillingTypeEnum.PIX) {
                console.log("[createPayment] Recuperando QR code PIX...");
                const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log({
                    pixQrCode,
                    pixPayload,
                });
                console.log("[createPayment] QR code PIX recuperado.");
            }

            const payment = await this.paymentRepository.create({
                id: 0,
                userId,
                planId: plan.id,
                amount: plan.price,
                status:
                    asaasPayment.status === ASAASPaymentStatusEnum.CONFIRMED
                        ? "PAID"
                        : "PENDING",
                installments: data.installments,
                paymentDate: dateWithTimeZone,
                createdAt: dateWithTimeZone,
                updatedAt: dateWithTimeZone,
                paymentIdAsaas: asaasPayment.id,
                couponId: coupon?.id,
                pixQrCode,
                pixPayload,
            });

            const createdSubscription =
                await this.subscriptionRepository.update(
                    subscription.id,
                    subscription,
                );

            return {
                subscription: createdSubscription,
                payment,
                asaasPayment,
            };
        }

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
            "[createPayment] Assinatura criada no ASAAS:",
            subscription.id,
        );

        return {
            subscription,
            payment,
        };
    }

    private async validateCoupon(
        code?: string,
        planId?: number,
        serviceIds?: number[],
    ) {
        if (!code) return null;

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
            !coupon.services?.some((service) => serviceIds?.includes(service.id))
        ) {
            throw new AppError("Cupom inválido", 400);
        }

        return coupon;
    }

    private validatePlanInstallments(plan: Plan, installments?: number) {
        if (plan.isPackage && plan.periodicityType === PeriodicityType.MONTH) {
            throw new AppError(
                "O plano no formato pacote não pode ter um prazo mensal",
                400,
            );
        }

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

    /**
     * Mapeia evento do ASAAS para status interno, como fallback ao ASAAS_EVENT_STATUS_MAP.
     */
    private mapEventToInternalStatus(
        event: string,
    ): "PAID" | "PENDING" | "CANCELED" | undefined {
        switch (event) {
            case "PAYMENT_CONFIRMED":
            case "PAYMENT_RECEIVED":
            case "PAYMENT_CREDIT_CARD_CAPTURED":
                return "PAID";
            case "PAYMENT_CREATED":
            case "PAYMENT_UPDATED":
            case "PAYMENT_OVERDUE":
                return "PENDING";
            case "PAYMENT_DELETED":
            case "PAYMENT_REFUNDED":
            case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
                return "CANCELED";
            default:
                return undefined;
        }
    }

    /**
     * Manipulador de webhook do ASAAS (pagamentos ou assinaturas).
     * Sempre retorna status 200 OK com uma mensagem curta.
     */
    public async paymentWebhook(body: ASAASWebhookEvent) {
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

            const newStatus =
                ASAAS_EVENT_STATUS_MAP[event] ??
                this.mapEventToInternalStatus(event);

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

            return { status: 200, message: "Webhook processado com sucesso" };
        } catch (error) {
            console.error("[paymentWebhook] Erro inesperado:", error);
            return { status: 200, message: "Erro interno", error };
        }
    }

    private async carHasSubscription(licensePlate: string) {
        const existingSubscription =
            await this.subscriptionRepository.findByCarLicensePlate(
                licensePlate,
            );
        if (!existingSubscription || !existingSubscription.isActive) {
            return false;
        }

        return true;
    }

    /**
     * Cria a assinatura no ASAAS com cobrança imediata (plano NÃO pacote).
     */
    private async createAsaasSubscription(
        data: CreateSubscriptionToPlanDTO & { userId: number },
        plan: Plan,
        customerId: string,
        coupon: Coupon | null,
        billingType: ASAASSubscriptionBillingTypeEnum,
    ) {
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

            const startDate = new Date();
            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            const subscription = await this.subscriptionRepository.create(
                new Subscription({
                    userId: data.userId,
                    planId: plan.id,
                    planType: cycle,
                    amount: plan.price,
                    isActive: false,
                    startDate,
                    carId: data.carId,
                    paymentMethod: billingType,
                    subscriptionIdAsaas: null,
                    couponId: coupon?.id,
                    expiresAt,
                }),
            );

            const payload: ASAASCreateSubscriptionDTO = {
                customer: customerId,
                nextDueDate: new Date().toISOString().split("T")[0],
                value: plan.price,
                billingType,
                cycle,
                description: `Plano: ${plan.name}`,
                externalReference: JSON.stringify({
                    userId: data.userId,
                    planId: plan.id,
                    couponId: coupon?.id,
                    subId: subscription.id,
                }),
                creditCard: !data.creditCard
                    ? undefined
                    : {
                        holderName: data.creditCard.holderName,
                        number: data.creditCard.number,
                        expiryMonth: data.creditCard.expiryMonth,
                        expiryYear: data.creditCard.expiryYear,
                        ccv: data.creditCard.ccv,
                    },
                creditCardHolderInfo: !data.creditCardHolderInfo
                    ? undefined
                    : {
                        name: data.creditCardHolderInfo.name,
                        email: data.creditCardHolderInfo.email,
                        cpfCnpj: data.creditCardHolderInfo.cpfCnpj,
                        phone: data.creditCardHolderInfo.phone,
                        postalCode: data.creditCardHolderInfo.postalCode,
                        addressNumber:
                        data.creditCardHolderInfo.addressNumber,
                        addressComplement:
                            data.creditCardHolderInfo.addressComplement ??
                            "",
                        mobilePhone:
                            data.creditCardHolderInfo.mobilePhone ??
                            data.creditCardHolderInfo.phone,
                    },
                discount: !coupon
                    ? undefined
                    : {
                        value: coupon.discountValue,
                        type: coupon.discountType,
                    },
            };

            console.log(
                "[createAsaasSubscription] Payload da assinatura:",
                JSON.stringify(payload, null, 2),
            );
            const asaasSubscription = await asaasCreateSubscription(
                payload,
                customerId,
            );

            subscription.subscriptionIdAsaas = asaasSubscription.id;
            subscription.amount = asaasSubscription.value;
            subscription.paymentMethod = billingType;
            await this.subscriptionRepository.update(
                subscription.id,
                subscription,
            );

            if (billingType === ASAASSubscriptionBillingTypeEnum.PIX) {
                console.log(
                    "[createPayment] Recuperando lista de pagamentos da assinatura...",
                );
                const paymentList = await asaasListSubscriptionPayments(
                    asaasSubscription.id,
                );
                const payment = paymentList.data[0];
                if (!payment) {
                    console.log(
                        "[createPayment] Nenhum pagamento encontrado para a assinatura.",
                    );
                    return {
                        status: 400,
                        message:
                            "Nenhum pagamento encontrado para a assinatura.",
                    };
                }
                console.log("[createPayment] Recuperando QR code PIX...");
                const asaasPixCode = await asaasGetPixQrCode(payment.id);
                const pixQrCode = asaasPixCode.encodedImage;
                const pixPayload = asaasPixCode.payload;
                console.log({
                    pixQrCode,
                    pixPayload,
                });
                console.log("[createPayment] QR code PIX recuperado.");

                const dbPayment = await this.paymentRepository.create(
                    new Payment({
                        userId: data.userId,
                        planId: plan.id,
                        couponId: coupon?.id,
                        amount: plan.price,
                        status: "PENDING",
                        paymentMethodId: payload.billingType,
                        paymentIdAsaas: payment.id,
                        pixQrCode,
                        pixPayload,
                    }),
                );

                return {
                    subscription: asaasSubscription,
                    payment: dbPayment,
                };
            }

            return { subscription: asaasSubscription, payment: null };
        } catch (error) {
            console.error(
                "[createAsaasSubscription] Erro ao criar assinatura:",
                error,
            );
            return { status: 400, message: "Erro ao criar assinatura", error };
        }
    }

    private async handleSubscriptionWebhook(
        body: ASAASWebhookEvent,
        newStatus: string,
    ) {
        const subscriptionAsaasId = body.subscription?.id;
        if (!subscriptionAsaasId) {
            return;
        }

        const localSubscription =
            await this.subscriptionRepository.getByAsaasId(
                subscriptionAsaasId,
            );
        if (!localSubscription) {
            console.log(
                `[Asaas Webhook] Assinatura ${subscriptionAsaasId} não encontrada localmente.`,
            );
            return;
        }

        if (newStatus === "CANCELED" || newStatus === "PENDING") {
            localSubscription.isActive = false;
            await this.subscriptionRepository.update(
                localSubscription.id,
                localSubscription,
            );
        }

        if (body.event === "SUBSCRIPTION_CREATED" && body.subscription) {
            console.info(
                `[handleSubscriptionWebhook] Processando criação de assinatura ${body.subscription.id}`,
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
                    "[handleSubscriptionWebhook] Erro ao extrair userId ou planId da referência externa.",
                );
                return {
                    status: 400,
                    message:
                        "Referência externa inválida na assinatura",
                };
            }

            const existingSubscription =
                await this.subscriptionRepository.getByAsaasId(
                    body.subscription.id,
                );
            if (existingSubscription) {
                console.info(
                    `[handleSubscriptionWebhook] Assinatura já existe no banco de dados: ${body.subscription.id}`,
                );
                return {
                    status: 200,
                    message: "Assinatura já registrada",
                };
            }

            console.info(
                `[handleSubscriptionWebhook] Registrando nova assinatura no banco de dados para userId: ${externalReferenceUserId}, planId: ${externalReferencePlanId}`,
            );

            const newSubscription = new Subscription({
                userId: externalReferenceUserId,
                planId: externalReferencePlanId,
                planType: body.subscription.cycle,
                amount: body.subscription.value,
                isActive: true,
                startDate: new Date(),
                endDate: new Date(body.subscription.nextDueDate),
                paymentMethod: body.subscription.billingType,
                subscriptionIdAsaas: body.subscription.id,
                couponId: externalReferenceCouponId,
            });

            await this.subscriptionRepository.create(newSubscription);
            console.info(
                `[handleSubscriptionWebhook] Assinatura salva com sucesso no banco de dados: ${body.subscription.id}`,
            );

            return {
                status: 200,
                message: "Assinatura processada com sucesso",
            };
        }
    }

    private async handlePaymentWebhook(
        body: ASAASWebhookEvent,
        newStatus: string,
    ) {
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

            let plan: Plan | null = null;

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
                plan = planExists;
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
                typeof body.payment.billingType === "string"
                    ? body.payment.billingType
                    : null;

            const paymentMethodId =
                paymentMethodIdFromBody ??
                existingPayment?.paymentMethodId ??
                null;

            const newPayment = new Payment({
                userId,
                planId,
                couponId,
                amount,
                status: newStatus as "PAID" | "PENDING" | "CANCELED",
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

                if (subId) {
                    subscription =
                        await this.subscriptionRepository.findById(subId);
                }

                if (subscription) {
                    await this.updateSubscriptionValidityFromPayment(
                        subscription,
                        paymentDate,
                        newStatus,
                    );

                    await this.updateSubscriptionActiveStatusFromPayment(
                        subscription,
                        newStatus,
                        plan,
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

                    await this.updateSubscriptionActiveStatusFromPayment(
                        subscription,
                        newStatus,
                        plan,
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

    private calculatePlanExpiration(plan: Plan, referenceDate: Date): Date {
        const baseDate = new Date(referenceDate.getTime());

        if (plan.duration && plan.duration > 0) {
            baseDate.setDate(baseDate.getDate() + plan.duration);
        } else {
            switch (plan.periodicityType) {
                case PeriodicityType.WEEK:
                    baseDate.setDate(baseDate.getDate() + 7);
                    break;
                case PeriodicityType.MONTH:
                    baseDate.setMonth(baseDate.getMonth() + 1);
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

        if (plan.extraMonths && plan.extraMonths > 0) {
            baseDate.setMonth(baseDate.getMonth() + plan.extraMonths);
        }

        return baseDate;
    }

    private async updateSubscriptionValidityFromPayment(
        subscription: Subscription,
        paymentDate: Date,
        newStatus: string,
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

        const expiresAt = this.calculatePlanExpiration(plan, paymentDate);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        subscription.startDate = paymentDate;
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

    /**
     * Helper antigo de atualização de assinatura a partir de pagamento.
     * Agora utilizado como camada de compatibilidade adicional.
     */
    private async updateSubscriptionActiveStatusFromPayment(
        subscription: Subscription,
        newStatus: string,
        planFromContext: Plan | null,
    ): Promise<void> {
        let isActive = false;

        if (newStatus === "PAID") {
            isActive = true;

            let plan: Plan | null = planFromContext;

            if (!plan && subscription.planId) {
                plan = await this.planRepository.findById(subscription.planId);
            }

            if (plan) {
                const now = new Date();
                const baseDate =
                    subscription.expiresAt && subscription.expiresAt > now
                        ? subscription.expiresAt
                        : now;

                const newExpiresAt = this.calculatePlanExpiration(
                    plan,
                    baseDate,
                );
                subscription.expiresAt = newExpiresAt;
            }
        }

        if (newStatus === "CANCELED") {
            isActive = false;
        }

        subscription.isActive = isActive;

        await this.subscriptionRepository.update(
            subscription.id,
            subscription,
        );

        console.log(
            `[updateSubscriptionActiveStatusFromPayment] Assinatura ${subscription.id} atualizada => isActive: ${isActive}, expiresAt: ${subscription.expiresAt}`,
        );
    }

    // --------------------------------------
    // Métodos adicionais para relatórios/estatísticas
    // --------------------------------------

    public async getMonthlyRevenueHistory() {
        return this.paymentRepository.getMonthlyRevenueHistory();
    }

    public async getYearlyRevenueHistory() {
        return this.paymentRepository.getYearlyRevenueHistory();
    }

    public async updatePaymentStatus(
        paymentId: number,
        status: "PAID" | "PENDING" | "CANCELED",
    ) {
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

    public async getPaymentDetailsById(paymentId: number) {
        return this.paymentRepository.getPaymentDetailsById(paymentId);
    }

    public async getMRR() {
        return this.paymentRepository.getMRR();
    }
}
