import prisma from "../../config/dbConfig";
import { AppError } from "../../error/AppError";

import { PaymentPolicy } from "./PaymentPolicy";
import {
    CouponPricingService,
    type CouponPricingResult,
    type CouponNormalized,
} from "./CouponPricingService";
import { PaymentCashbackService } from "./PaymentCashbackService";
import { AsaasBillingService } from "./AsaasBillingService";

import {
    asaasCreatePayment,
    asaasGetPixQrCode,
} from "../../utils/asaas/asaasPayments";
import {
    ASAASPaymentBillingTypeEnum,
    ASAASPaymentStatusEnum,
} from "../../utils/asaas/types/paymentTypes";
import { CreatePaymentDTO } from "./dto/CreatePaymentDTO";

/**
 * PaymentCreateService
 * - pagamento avulso baseado em washServices (serviços obrigatórios no DTO)
 * - aplica cupom (mínimo) + cashback (regra) sem duplicar lógica
 * - cria cobrança no ASAAS e persiste Payment local
 *
 * Fonte da verdade:
 * - externalReference: PaymentPolicy (compact <= 100 + retrocompat)
 * - cupom: CouponPricingService
 * - cashback: PaymentCashbackService
 * - status ASAAS -> interno: AsaasBillingService.mapAsaasPaymentStatusToInternal
 */
export class PaymentCreateService {
    constructor(
        private readonly couponPricingService: CouponPricingService,
        private readonly paymentCashbackService: PaymentCashbackService,
        private readonly asaasBillingService: AsaasBillingService,
    ) {}

    private ensureUserHasCustomerId(user: {
        id: number;
        customerIdAsaas?: string | null;
    }): string {
        const id =
            typeof user.customerIdAsaas === "string"
                ? user.customerIdAsaas.trim()
                : "";
        if (!id) {
            throw new AppError(
                "Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de cobrar.",
                400,
            );
        }
        return id;
    }

    private async resolveWashServicesTotalAmountOrThrow(
        washServiceIds: number[],
    ): Promise<number> {
        if (!Array.isArray(washServiceIds) || washServiceIds.length === 0) {
            throw new AppError("Selecione pelo menos um serviço", 400);
        }

        // OBS: ajuste o model/field se no teu prisma o nome não for washService/price
        const rows = await prisma.washService.findMany({
            where: { id: { in: washServiceIds } } as any,
            select: { id: true, price: true } as any,
        });

        if (rows.length !== washServiceIds.length) {
            const foundIds = new Set(rows.map((r: any) => Number(r.id)));
            const missing = washServiceIds.filter((id) => !foundIds.has(id));
            throw new AppError(
                `Serviço(s) não encontrado(s): ${missing.join(", ")}`,
                404,
            );
        }

        const total = rows.reduce((acc: number, r: any) => {
            const price = PaymentPolicy.normalizeMoney(r.price);
            return acc + price;
        }, 0);

        if (total <= 0) {
            throw new AppError(
                "Valor inválido para cobrança (total dos serviços <= 0).",
                400,
            );
        }

        return PaymentPolicy.normalizeMoney(total);
    }

    private buildDescription(washServiceIds: number[]): string {
        return `Pagamento avulso - serviços: ${washServiceIds.join(", ")}`;
    }

    public async createPayment(
        data: CreatePaymentDTO,
        userId: number,
    ): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { id: userId } as any,
        });
        if (!user) throw new AppError("Usuário não encontrado", 404);

        const customerId = this.ensureUserHasCustomerId({
            id: (user as any).id,
            customerIdAsaas:
                (user as any).customerIdAsaas ??
                (user as any).asaasCustomerId ??
                null,
        });

        const paymentType = data.type ?? "creditCard";

        const billingType =
            paymentType === "pix"
                ? ASAASPaymentBillingTypeEnum.PIX
                : ASAASPaymentBillingTypeEnum.CREDIT_CARD;

        if (paymentType === "creditCard") {
            if (!data.creditCard)
                throw new AppError("Faltam informações cartão", 400);
            if (!data.creditCardHolderInfo)
                throw new AppError(
                    "Faltam informações do titular do cartão",
                    400,
                );
            if (!data.creditCardHolderInfo.phone)
                throw new AppError("Telefone é obrigatório para cartão", 400);
        }

        const minimumCharge = PaymentPolicy.ensureMinimumAmount(
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
        );

        const baseAmount = await this.resolveWashServicesTotalAmountOrThrow(
            data.washServices,
        );

        const couponCode = PaymentPolicy.normalizeOptionalString(data.coupon);

        // ✅ TIPAGEM CERTA: validateCoupon retorna CouponNormalized | null
        const coupon: CouponNormalized | null =
            await this.couponPricingService.validateCoupon(
                couponCode,
                undefined,
                data.washServices,
            );

        const couponPricing: CouponPricingResult =
            this.couponPricingService.applyCouponWithMinimumCharge(
                baseAmount,
                coupon,
                minimumCharge,
            );

        const requestedCashback = PaymentPolicy.parseCashbackAmount(
            data.cashbackAmount ?? 0,
        );

        const cashbackPricing =
            await this.paymentCashbackService.resolveCashbackUsageOrThrow({
                userId,
                requestedCashback,
                amountAfterCoupon: couponPricing.finalAmount,
                minimumCharge,
            });

        const finalAmount = PaymentPolicy.ensureMinimumAmount(
            cashbackPricing.amountAfterCashback,
            minimumCharge,
        );

        const timeZoneOffsetMinutes =
            PaymentPolicy.resolveTimeZoneOffsetMinutes(undefined, -180);

        const externalReference = PaymentPolicy.buildAsaasExternalReference({
            userId,
            planId: undefined,
            couponId: coupon ? coupon.id : undefined,
            subId: undefined,
            cashbackUsedAmount: cashbackPricing.cashbackUsed,
            cashbackBaseAmount: couponPricing.finalAmount,
            cashbackRequestedAmount: requestedCashback,
            minimumCharge,
            timeZoneOffsetMinutes,
        });

        const dueDateStr = PaymentPolicy.isoDateString(new Date());
        const dueAt = PaymentPolicy.parseIsoDateToDate(dueDateStr) ?? new Date();

        const payload: Parameters<typeof asaasCreatePayment>[0] = {
            billingType,
            dueDate: dueDateStr,
            value: finalAmount,
            customer: customerId,
            description: this.buildDescription(data.washServices),
            externalReference: externalReference || undefined,
        };

        if (billingType === ASAASPaymentBillingTypeEnum.CREDIT_CARD) {
            (payload as any).creditCard = data.creditCard;
            (payload as any).creditCardHolderInfo = data.creditCardHolderInfo;
        }

        const asaasPayment = await asaasCreatePayment(payload);

        let pixQrCode: string | null = null;
        let pixPayload: string | null = null;

        if (billingType === ASAASPaymentBillingTypeEnum.PIX) {
            const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
            pixQrCode = asaasPixCode.encodedImage;
            pixPayload = asaasPixCode.payload;
        }

        const internalStatus =
            this.asaasBillingService.mapAsaasPaymentStatusToInternal(
                asaasPayment.status as ASAASPaymentStatusEnum,
            );

        const dbPayment = await prisma.payment.create({
            data: {
                userId,
                planId: null,
                couponId: coupon ? coupon.id : null,
                amount: finalAmount,
                status: internalStatus,
                paymentMethodId: billingType.toString(),
                paymentIdAsaas: asaasPayment.id,
                paymentDate: dueAt,
                dueAt,
                createdAt: new Date(),
                updatedAt: new Date(),
                pixQrCode,
                pixPayload,
                installments: null,
                cashbackUsedAmount:
                    cashbackPricing.cashbackUsed > 0
                        ? cashbackPricing.cashbackUsed
                        : null,

                // Só mantém se existir no schema Payment
                washServices: data.washServices as any,
                cpf: data.cpf ?? null,
            } as any,
        });

        return dbPayment;
    }
}
