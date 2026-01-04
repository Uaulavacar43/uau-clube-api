import { AppError } from "../../error/AppError";
import { PaymentPolicy } from "./PaymentPolicy";
import type { ICouponRepository } from "../../repositories/interfaces/ICouponRepository";
import type { DiscountType } from "@prisma/client";

export type CouponNormalized = {
    id: number;
    code: string;

    createdAt: Date;
    updatedAt: Date;

    isActive: boolean;

    description: string;
    additionalInfo: string | null;

    discountType: DiscountType;
    discountValue: number;

    maxDiscountValue: number | null;

    // ✅ agora SEM null (como o teu TS exige)
    validFrom: Date;
    validUntil: Date;

    usageLimit: number | null;
    currentUsage: number;

    plans?: Array<{ id: number }> | null;
    services?: Array<{ id: number }> | null;
};

export type CouponPricingResult = {
    finalAmount: number;
    asaasDiscount?: {
        value: number;
        dueDateLimitDays?: number;
        type: "PERCENTAGE" | "FIXED";
    };
    appliedDiscountValue: number;
};

export class CouponPricingService {
    constructor(private readonly couponRepository: ICouponRepository) {}

    private ensureMinimumAmount(
        value: number,
        minimum = PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
    ): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return minimum;
        if (n <= 0) return minimum;
        return Number(n.toFixed(2));
    }

    private toDateOrNull(value: unknown): Date | null {
        if (value == null) return null;
        if (value instanceof Date) return value;
        const d = new Date(value as any);
        if (Number.isNaN(d.getTime())) return null;
        return d;
    }

    private toNumberOrNull(value: unknown): number | null {
        if (value == null) return null;
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return n;
    }

    private toNumberOrZero(value: unknown): number {
        if (value == null) return 0;
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return n;
    }

    /**
     * Normaliza o cupom para o shape exigido pelo módulo de pagamento.
     * - validFrom/validUntil SEM null (contrato estável)
     * - additionalInfo SEM undefined (vira null)
     */
    private normalizeCoupon(raw: any): CouponNormalized {
        const id = Number(raw?.id);
        const code = String(raw?.code ?? "").trim();

        if (!Number.isFinite(id) || id <= 0) {
            throw new AppError("Cupom inválido (id)", 500);
        }
        if (!code) {
            throw new AppError("Cupom inválido (code)", 500);
        }

        const createdAt =
            raw?.createdAt instanceof Date
                ? raw.createdAt
                : new Date(raw?.createdAt ?? Date.now());

        const updatedAt =
            raw?.updatedAt instanceof Date
                ? raw.updatedAt
                : new Date(raw?.updatedAt ?? Date.now());

        const additionalInfoRaw = raw?.additionalInfo;

        // ✅ default coerente (não muda regra; só evita null no tipo)
        const validFromRaw = this.toDateOrNull(raw?.validFrom);
        const validUntilRaw = this.toDateOrNull(raw?.validUntil);

        const validFrom = validFromRaw ?? createdAt;
        const validUntil = validUntilRaw ?? new Date("2099-12-31T23:59:59.999Z");

        const coupon: CouponNormalized = {
            id,
            code,

            createdAt,
            updatedAt,

            isActive: Boolean(raw?.isActive),

            description: String(raw?.description ?? ""),
            additionalInfo:
                additionalInfoRaw === undefined ? null : (additionalInfoRaw ?? null),

            discountType: raw?.discountType as DiscountType,
            discountValue: this.toNumberOrZero(raw?.discountValue),

            maxDiscountValue: this.toNumberOrNull(raw?.maxDiscountValue),

            validFrom,
            validUntil,

            usageLimit: this.toNumberOrNull(raw?.usageLimit),
            currentUsage: this.toNumberOrZero(raw?.currentUsage),

            plans: Array.isArray(raw?.plans)
                ? raw.plans.map((p: any) => ({ id: Number(p?.id) }))
                : raw?.plans ?? null,

            services: Array.isArray(raw?.services)
                ? raw.services.map((s: any) => ({ id: Number(s?.id) }))
                : raw?.services ?? null,
        };

        return coupon;
    }

    public async validateCoupon(
        code?: string,
        planId?: number,
        serviceIds?: number[],
    ): Promise<CouponNormalized | null> {
        if (!code) return null;

        const couponRaw = await this.couponRepository.findByCode(code);
        if (!couponRaw) {
            throw new AppError("Cupom inválido", 404);
        }

        const coupon = this.normalizeCoupon(couponRaw);

        if (!coupon.isActive) throw new AppError("Cupom inválido", 400);

        // fonte da verdade
        if (this.couponRepository.isExpired(couponRaw as any)) {
            throw new AppError("Cupom inválido", 400);
        }
        if (this.couponRepository.isNotStarted(couponRaw as any)) {
            throw new AppError("Cupom inválido", 400);
        }
        if (this.couponRepository.hasReachedUsageLimit(couponRaw as any)) {
            throw new AppError("Cupom inválido", 400);
        }

        const hasPlansRelation = (coupon.plans?.length ?? 0) > 0;
        if (hasPlansRelation && planId) {
            const ok = coupon.plans?.some((p) => p.id === planId);
            if (!ok) throw new AppError("Cupom inválido", 400);
        }

        const hasServicesRelation = (coupon.services?.length ?? 0) > 0;
        if (hasServicesRelation && serviceIds) {
            const ok = coupon.services?.some((s) => serviceIds.includes(s.id));
            if (!ok) throw new AppError("Cupom inválido", 400);
        }

        return coupon;
    }

    public applyCouponWithMinimumCharge(
        baseAmount: number,
        coupon: CouponNormalized | null,
        minimumCharge: number = PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
    ): CouponPricingResult {
        if (!coupon) {
            return { finalAmount: baseAmount, appliedDiscountValue: 0 };
        }

        if (baseAmount <= 0) {
            return { finalAmount: baseAmount, appliedDiscountValue: 0 };
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

        const discountType =
            String(coupon.discountType) === "PERCENTAGE" ? "PERCENTAGE" : "FIXED";

        if (discountType === "PERCENTAGE") {
            const requestedPercent = Number(coupon.discountValue) || 0;
            const requestedDiscount = (baseAmount * requestedPercent) / 100;

            let appliedDiscount = Math.min(requestedDiscount, maxDiscount);

            if (coupon.maxDiscountValue != null && coupon.maxDiscountValue >= 0) {
                appliedDiscount = Math.min(
                    appliedDiscount,
                    PaymentPolicy.normalizeMoney(coupon.maxDiscountValue),
                );
            }

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

        let requestedDiscount = Number(coupon.discountValue) || 0;
        if (requestedDiscount < 0) requestedDiscount = 0;

        let appliedDiscount = Math.min(requestedDiscount, maxDiscount);

        if (coupon.maxDiscountValue != null && coupon.maxDiscountValue >= 0) {
            appliedDiscount = Math.min(
                appliedDiscount,
                PaymentPolicy.normalizeMoney(coupon.maxDiscountValue),
            );
        }

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
