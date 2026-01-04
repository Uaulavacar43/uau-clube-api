// src/modules/payment/services/AsaasBillingService.ts

import { PaymentPolicy } from "./PaymentPolicy";
import { ASAASPaymentStatusEnum } from "../../utils/asaas/types/paymentTypes";
import { ASAASWebhookEventEnum } from "../../utils/asaas/types/webhookTypes";
import { ASAAS_EVENT_STATUS_MAP } from "../../utils/asaas/asaasEventMap";

/**
 * ---------------------------------------------------------------------
 * Tipos internos para MODIFIERS do ASAAS
 * ---------------------------------------------------------------------
 *
 * Responsabilidades (agora):
 * - resolvePaymentType
 * - map status ASAAS -> status interno
 * - build modifiers (discount/fine/interest)
 * - buildCombinedAsaasDiscountFixed (cupom + cashback)
 * - resolveInternalStatus (por evento webhook)
 *
 * IMPORTANTE:
 * - ExternalReference NÃO pertence mais aqui.
 *   (build/parse/resolveFinalAmount) => PaymentPolicy
 */
export type AsaasDiscountType = "PERCENTAGE" | "FIXED";

export type AsaasDiscountPayload = {
    value: number;
    dueDateLimitDays?: number;
    type: AsaasDiscountType;
};

export type AsaasFineType = "PERCENTAGE" | "FIXED";
export type AsaasFinePayload = {
    value: number;
    type: AsaasFineType;
};

export type AsaasInterestPayload = {
    value: number;
};

export type AsaasBillingModifiers = {
    discount?: AsaasDiscountPayload;
    fine?: AsaasFinePayload;
    interest?: AsaasInterestPayload;
};

export class AsaasBillingService {
    public resolvePaymentType(type: unknown): "creditCard" | "pix" {
        return (type ?? "creditCard") === "pix" ? "pix" : "creditCard";
    }

    public mapAsaasPaymentStatusToInternal(
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

    public buildAsaasBillingModifiers(
        mod: AsaasBillingModifiers,
    ): Partial<AsaasBillingModifiers> {
        const out: AsaasBillingModifiers = {};

        if (mod.discount) out.discount = mod.discount;
        if (mod.fine) out.fine = mod.fine;
        if (mod.interest) out.interest = mod.interest;

        return out;
    }

    /**
     * Combina cupom + cashback em um desconto FIXED do ASAAS,
     * respeitando "mínimo a pagar".
     */
    public buildCombinedAsaasDiscountFixed(params: {
        baseAmount: number;
        appliedCouponDiscountValue: number;
        cashbackUsed: number;
        minimumCharge: number;
    }): AsaasDiscountPayload | undefined {
        const base = Number(params.baseAmount) || 0;
        if (base <= 0) return undefined;

        const totalDiscount = Number(
            (
                Number(params.appliedCouponDiscountValue || 0) +
                Number(params.cashbackUsed || 0)
            ).toFixed(2),
        );

        if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
            return undefined;
        }

        const minCharge = PaymentPolicy.ensureMinimumAmount(params.minimumCharge);

        const maxAllowedDiscount = Math.max(0, base - minCharge);
        if (maxAllowedDiscount <= 0) return undefined;

        const applied = Math.min(totalDiscount, maxAllowedDiscount);

        if (applied <= 0) return undefined;

        return {
            value: Number(applied.toFixed(2)),
            type: "FIXED",
        };
    }

    // ---------------------------------------------------------------------
    // Webhook ASAAS => status interno
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

    public resolveInternalStatus(
        event: ASAASWebhookEventEnum,
    ): "PAID" | "PENDING" | "CANCELED" | undefined {
        const mapped = ASAAS_EVENT_STATUS_MAP[event];
        if (mapped) {
            return mapped;
        }
        return this.mapEventToInternalStatus(event);
    }
}
