// src/modules/payment/SubscriptionCreateService.ts
import prisma from "../../config/dbConfig";
import { AppError } from "../../error/AppError";

import type { Coupon } from "@prisma/client";
import type { Plan } from "../../entities/Plan";

import { PaymentPolicy } from "./PaymentPolicy";
import {
    CouponPricingService,
    type CouponPricingResult,
} from "./CouponPricingService";
import { PaymentCashbackService } from "./PaymentCashbackService";
import { SubscriptionLifecycleService } from "./SubscriptionLifecycleService";

import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import { ASAASSubscriptionBillingTypeEnum } from "../../utils/asaas/types/subscriptionTypes";

/**
 * SubscriptionCreateService
 * - assinatura de plano + 1ª cobrança avulsa (se teu lifecycle fizer isso)
 * - cupom + mínimo + cashback
 * - delega criação/fluxo para SubscriptionLifecycleService (fonte da verdade)
 *
 * Correções aplicadas:
 * 1) Plan do entities exige washServices -> carregamos com include washServices.
 * 2) createAsaasSubscription exige DTO & { userId } -> passamos userId no DTO.
 * 3) NÃO adicionamos props extras no DTO (timeZoneOffsetMinutes/cashbackRequestedAmount),
 *    porque estoura tipagem. Essas normalizações ficam no "options" final.
 *
 * Decisão de tipagem do cupom:
 * - validateCoupon pode retornar "CouponNormalized" parcial
 * - aqui sempre hidratamos para Coupon do Prisma (por id ou code)
 */
export class SubscriptionCreateService {
    constructor(
        private readonly couponPricingService: CouponPricingService,
        private readonly paymentCashbackService: PaymentCashbackService,
        private readonly subscriptionLifecycleService: SubscriptionLifecycleService,
    ) {}

    private ensureUserHasCustomerId(user: {
        id: number;
        customerIdAsaas?: string | null;
    }): string {
        const id =
            typeof user.customerIdAsaas === "string" ? user.customerIdAsaas.trim() : "";
        if (!id) {
            throw new AppError(
                "Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
                400,
            );
        }
        return id;
    }

    private extractNumericId(value: unknown): number | null {
        if (typeof value !== "object" || value === null) return null;
        if (!("id" in value)) return null;

        const maybeId = (value as { id?: unknown }).id;
        if (typeof maybeId === "number" && Number.isFinite(maybeId) && maybeId > 0) {
            return maybeId;
        }

        return null;
    }

    private extractCouponCode(value: unknown): string | null {
        if (typeof value !== "object" || value === null) return null;
        if (!("code" in value)) return null;

        const maybeCode = (value as { code?: unknown }).code;
        if (typeof maybeCode !== "string") return null;

        const code = maybeCode.trim();
        return code.length > 0 ? code : null;
    }

    private async loadPrismaCouponOrNull(validated: unknown): Promise<Coupon | null> {
        if (!validated) return null;

        const id = this.extractNumericId(validated);
        if (id) {
            const db = await prisma.coupon.findUnique({ where: { id } });
            return db ?? null;
        }

        const code = this.extractCouponCode(validated);
        if (code) {
            const db = await prisma.coupon.findFirst({
                where: { code },
                orderBy: { id: "desc" },
            });
            return db ?? null;
        }

        return null;
    }

    private async loadPlanOrThrow(planId: number): Promise<Plan> {
        const plan = await prisma.plan.findUnique({
            where: { id: planId },
            include: {
                washServices: true,
            },
        });

        if (!plan) throw new AppError("Plano não encontrado", 404);

        const price = PaymentPolicy.normalizeMoney(plan.price);
        if (price <= 0) {
            throw new AppError("Plano inválido para assinatura (preço <= 0)", 400);
        }

        // O type Plan (entities/Plan) exige washServices.
        // Como carregamos com include, aqui já existe.
        return plan as unknown as Plan;
    }

    public async subscribeToPlan(
        data: CreateSubscriptionToPlanDTO,
        userId: number,
    ): Promise<unknown> {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("Usuário não encontrado", 404);

        const customerId = this.ensureUserHasCustomerId({
            id: user.id,
            customerIdAsaas:
                (user as { customerIdAsaas?: string | null }).customerIdAsaas ??
                (user as { asaasCustomerId?: string | null }).asaasCustomerId ??
                null,
        });

        const plan = await this.loadPlanOrThrow(data.plan_id);

        // Regra final de parcelas no lifecycle
        this.subscriptionLifecycleService.validatePlanInstallments(
            plan,
            data.installments,
        );

        const paymentType = data.type ?? "creditCard";
        const billingType =
            paymentType === "pix"
                ? ASAASSubscriptionBillingTypeEnum.PIX
                : ASAASSubscriptionBillingTypeEnum.CREDIT_CARD;

        // Defesa extra (DTO já valida via refine)
        if (paymentType === "creditCard") {
            if (!data.creditCard) throw new AppError("Faltam informações cartão", 400);
            if (!data.creditCardHolderInfo) {
                throw new AppError("Faltam informações do titular do cartão", 400);
            }
            if (!data.creditCardHolderInfo.phone) {
                throw new AppError("Telefone é obrigatório para cartão", 400);
            }
        }

        const minimumCharge = PaymentPolicy.ensureMinimumAmount(
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
        );

        const couponCode = PaymentPolicy.normalizeOptionalString(data.coupon);

        // validateCoupon pode devolver objeto parcial -> hidrata para Prisma Coupon
        const validatedCoupon = await this.couponPricingService.validateCoupon(
            couponCode,
            (plan as unknown as { id: number }).id,
            undefined,
        );

        const coupon = await this.loadPrismaCouponOrNull(validatedCoupon);

        const baseAmount = PaymentPolicy.normalizeMoney(
            (plan as unknown as { price: number }).price,
        );

        const planCouponPricing: CouponPricingResult =
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
                amountAfterCoupon: planCouponPricing.finalAmount,
                minimumCharge,
            });

        const timeZoneOffsetMinutes = PaymentPolicy.resolveTimeZoneOffsetMinutes(
            data.timeZoneOffset,
            -180,
        );

        // ✅ DTO que o lifecycle espera: CreateSubscriptionToPlanDTO & { userId: number }
        // NÃO adiciona props extras aqui (timeZoneOffsetMinutes/cashbackRequestedAmount),
        // porque estoura a tipagem do createAsaasSubscription.
        const dtoForLifecycle: CreateSubscriptionToPlanDTO & { userId: number } = {
            ...data,
            userId,
        };

        const result = await this.subscriptionLifecycleService.createAsaasSubscription(
            dtoForLifecycle,
            plan,
            customerId,
            coupon,
            billingType,
            {
                startDate: new Date(),
                timeZoneOffsetMinutes,
                requestedCashback,
                planCouponPricing,
                cashbackPricing,
            },
        );

        return result;
    }
}
