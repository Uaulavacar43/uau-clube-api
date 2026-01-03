// src/modules/payment/services/CouponPricingService.ts

import { PaymentPolicy } from "./PaymentPolicy";
import type { AsaasDiscountPayload, AsaasDiscountType } from "./AsaasBillingService";
import { ICouponRepository } from "../../repositories/interfaces/ICouponRepository";
import { AppError } from "../../error/AppError";
import { Coupon } from "../../entities/Coupon";

export type CouponPricingResult = {
    finalAmount: number;
    asaasDiscount?: AsaasDiscountPayload;
    appliedDiscountValue: number;
};

export class CouponPricingService {
    constructor(
        private readonly couponRepository: ICouponRepository,
    ) {}

    // ---------------------------------------------------------------------
    // (Mesma semântica do PaymentService.ensureMinimumAmount)
    // ---------------------------------------------------------------------
    private ensureMinimumAmount(
        value: number,
        minimum = PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
    ): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return minimum;
        if (n <= 0) return minimum;
        return Number(n.toFixed(2));
    }

    // ---------------------------------------------------------------------
    // Validações de cupom (IDÊNTICO ao PaymentService)
    // ---------------------------------------------------------------------
    public async validateCoupon(
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

    // ---------------------------------------------------------------------
    // REGRA DE CUPOM (mínimo a pagar) + valor aplicado (IDÊNTICO)
    // ---------------------------------------------------------------------
    public applyCouponWithMinimumCharge(
        baseAmount: number,
        coupon: Coupon | null,
        minimumCharge: number = PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
    ): CouponPricingResult {
        if (!coupon) {
            return {
                finalAmount: baseAmount,
                appliedDiscountValue: 0,
            };
        }

        if (baseAmount <= 0) {
            return {
                finalAmount: baseAmount,
                appliedDiscountValue: 0,
            };
        }

        const minCharge = this.ensureMinimumAmount(
            minimumCharge,
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
        );

        const maxDiscount = Math.max(0, baseAmount - minCharge);

        if (maxDiscount <= 0) {
            return {
                finalAmount: minCharge,
                appliedDiscountValue: Math.max(0, baseAmount - minCharge),
            };
        }

        const discountType: AsaasDiscountType =
            coupon.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FIXED";

        if (discountType === "PERCENTAGE") {
            const requestedPercent = Number(coupon.discountValue) || 0;
            const requestedDiscount = (baseAmount * requestedPercent) / 100;

            const appliedDiscount = Math.min(requestedDiscount, maxDiscount);
            const finalAmount = baseAmount - appliedDiscount;

            const effectivePercent =
                baseAmount > 0 ? (appliedDiscount / baseAmount) * 100 : 0;

            if (effectivePercent <= 0) {
                return {
                    finalAmount: this.ensureMinimumAmount(finalAmount, minCharge),
                    appliedDiscountValue: Number(appliedDiscount.toFixed(2)),
                };
            }

            return {
                finalAmount: this.ensureMinimumAmount(finalAmount, minCharge),
                asaasDiscount: {
                    value: Number(effectivePercent.toFixed(2)),
                    type: "PERCENTAGE",
                },
                appliedDiscountValue: Number(appliedDiscount.toFixed(2)),
            };
        }

        const requestedDiscount = Number(coupon.discountValue) || 0;
        const appliedDiscount = Math.min(requestedDiscount, maxDiscount);
        const finalAmount = baseAmount - appliedDiscount;

        if (appliedDiscount <= 0) {
            return {
                finalAmount: this.ensureMinimumAmount(finalAmount, minCharge),
                appliedDiscountValue: 0,
            };
        }

        return {
            finalAmount: this.ensureMinimumAmount(finalAmount, minCharge),
            asaasDiscount: {
                value: Number(appliedDiscount.toFixed(2)),
                type: "FIXED",
            },
            appliedDiscountValue: Number(appliedDiscount.toFixed(2)),
        };
    }
}
