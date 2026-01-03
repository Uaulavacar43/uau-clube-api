// src/modules/payment/services/AsaasBillingService.ts

import { PaymentPolicy } from "./PaymentPolicy";
import { ASAASPaymentStatusEnum } from "../../utils/asaas/types/paymentTypes";
import { ASAASWebhookEventEnum } from "../../utils/asaas/types/webhookTypes";
import { ASAAS_EVENT_STATUS_MAP } from "../../utils/asaas/asaasEventMap";

/**
 * ---------------------------------------------------------------------
 * Tipos internos para MODIFIERS do ASAAS (Fase 4 pronta)
 * ---------------------------------------------------------------------
 *
 * - discount: usado para cupom + cashback (Fase 4)
 * - fine/interest: previstos para fase 4+ (sem refatorar depois)
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

/**
 * ---------------------------------------------------------------------
 * ExternalReference compacto (A) + parse
 * ---------------------------------------------------------------------
 *
 * Formato (v2):
 *   v2|u:<userId>|p:<planId>|c:<couponId>|s:<subscriptionId>|b:<base>|d:<discount>|k:<cashback>|f:<final>
 *
 * - Não usa JSON (evita estourar limite)
 * - Mantém compatibilidade com legado (JSON stringify)
 */
export type AsaasExternalReferenceParsed = {
    version: "v2" | "legacy_json" | "unknown";
    userId?: string;
    planId?: string;
    couponId?: string;
    subscriptionId?: string;

    // valores em REAIS (number com 2 casas)
    baseAmount?: number;
    discountAmount?: number;
    cashbackUsed?: number;
    finalAmount?: number;
};

const ASAAS_EXTERNAL_REFERENCE_MAX_LEN = 255;

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
    // (A) ExternalReference v2 compact + parse
    // ---------------------------------------------------------------------

    private safeAmount(value: unknown): number | undefined {
        if (value === null || value === undefined) return undefined;

        const n =
            typeof value === "number"
                ? value
                : typeof value === "string"
                    ? Number(value)
                    : NaN;

        if (!Number.isFinite(n)) return undefined;

        // padroniza 2 casas
        return Number(n.toFixed(2));
    }

    /**
     * Build externalReference compacto (v2) — evita JSON e respeita limite.
     */
    public buildAsaasExternalReferenceCompact(input: {
        userId: string;
        planId?: string | null;
        couponId?: string | null;
        subscriptionId?: string | null;

        // valores em REAIS
        baseAmount?: number | null;
        discountAmount?: number | null;
        cashbackUsed?: number | null;
        finalAmount?: number | null;
    }): string {
        const parts: string[] = ["v2"];

        const push = (k: string, v?: string | number | null) => {
            if (v === null || v === undefined) return;
            const s = String(v).trim();
            if (!s) return;
            parts.push(`${k}:${s}`);
        };

        // essenciais
        push("u", input.userId);

        // ids opcionais
        push("p", input.planId ?? undefined);
        push("c", input.couponId ?? undefined);
        push("s", input.subscriptionId ?? undefined);

        // valores (mantém 2 casas)
        const b = this.safeAmount(input.baseAmount);
        const d = this.safeAmount(input.discountAmount);
        const k = this.safeAmount(input.cashbackUsed);
        const f = this.safeAmount(input.finalAmount);

        push("b", b ?? undefined);
        push("d", d ?? undefined);
        push("k", k ?? undefined);
        push("f", f ?? undefined);

        const ref = parts.join("|");
        if (ref.length <= ASAAS_EXTERNAL_REFERENCE_MAX_LEN) return ref;

        // se estourou, “poda” preservando o essencial
        const pruned: string[] = ["v2", `u:${input.userId}`];

        // ordem de prioridade (mantém o que for cabendo)
        const candidates: Array<[string, unknown]> = [
            ["p", input.planId],
            ["s", input.subscriptionId],
            ["c", input.couponId],
            ["f", f],
            ["b", b],
            ["d", d],
            ["k", k],
        ];

        for (const [key, val] of candidates) {
            if (val === null || val === undefined) continue;
            const token = `${key}:${String(val).trim()}`;
            if (!token.endsWith(":")) {
                pruned.push(token);
                const candidate = pruned.join("|");
                if (candidate.length > ASAAS_EXTERNAL_REFERENCE_MAX_LEN) {
                    pruned.pop();
                }
            }
        }

        const candidate = pruned.join("|");
        if (candidate.length > ASAAS_EXTERNAL_REFERENCE_MAX_LEN) {
            throw new Error(
                `ASAAS externalReference excedeu ${ASAAS_EXTERNAL_REFERENCE_MAX_LEN} chars (len=${candidate.length}).`,
            );
        }

        return candidate;
    }

    /**
     * Parse do externalReference.
     * Suporta:
     * - v2 compact (pipe + key:value)
     * - legado JSON (externalReference era JSON.stringify)
     */
    public parseAsaasExternalReference(
        externalReference?: string | null,
    ): AsaasExternalReferenceParsed {
        if (!externalReference) return { version: "unknown" };

        const raw = externalReference.trim();
        if (!raw) return { version: "unknown" };

        // legado JSON
        if (raw.startsWith("{") && raw.endsWith("}")) {
            try {
                const obj = JSON.parse(raw) as Record<string, unknown>;

                return {
                    version: "legacy_json",
                    userId: typeof obj.userId === "string" ? obj.userId : undefined,
                    planId: typeof obj.planId === "string" ? obj.planId : undefined,
                    couponId: typeof obj.couponId === "string" ? obj.couponId : undefined,
                    subscriptionId:
                        typeof obj.subscriptionId === "string" ? obj.subscriptionId : undefined,

                    baseAmount: this.safeAmount(obj.baseAmount ?? obj.base),
                    discountAmount: this.safeAmount(obj.discountAmount ?? obj.discount),
                    cashbackUsed: this.safeAmount(obj.cashbackUsed ?? obj.cashback),
                    finalAmount: this.safeAmount(obj.finalAmount ?? obj.final),
                };
            } catch {
                return { version: "unknown" };
            }
        }

        // v2 compact
        if (raw.startsWith("v2")) {
            const tokens = raw.split("|");
            const out: AsaasExternalReferenceParsed = { version: "v2" };

            for (const token of tokens.slice(1)) {
                const idx = token.indexOf(":");
                if (idx <= 0) continue;

                const key = token.slice(0, idx).trim();
                const value = token.slice(idx + 1).trim();
                if (!value) continue;

                switch (key) {
                    case "u":
                        out.userId = value;
                        break;
                    case "p":
                        out.planId = value;
                        break;
                    case "c":
                        out.couponId = value;
                        break;
                    case "s":
                        out.subscriptionId = value;
                        break;
                    case "b":
                        out.baseAmount = this.safeAmount(value);
                        break;
                    case "d":
                        out.discountAmount = this.safeAmount(value);
                        break;
                    case "k":
                        out.cashbackUsed = this.safeAmount(value);
                        break;
                    case "f":
                        out.finalAmount = this.safeAmount(value);
                        break;
                }
            }

            return out;
        }

        return { version: "unknown" };
    }

    /**
     * (A) Offset do timezone em minutos para um instante.
     * Útil quando você precisa “normalizar” data/hora vindo do ASAAS em TZ local.
     */
    public resolveTimeZoneOffsetMinutes(
        date: Date,
        timeZone: string = "America/Fortaleza",
    ): number {
        try {
            const dtf = new Intl.DateTimeFormat("en-US", {
                timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });

            const parts = dtf.formatToParts(date);
            const get = (type: string) => parts.find((p) => p.type === type)?.value;

            const y = Number(get("year"));
            const m = Number(get("month"));
            const d = Number(get("day"));
            const hh = Number(get("hour"));
            const mm = Number(get("minute"));
            const ss = Number(get("second"));

            const asIfUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
            const realUTC = date.getTime();

            return Math.round((asIfUTC - realUTC) / 60000);
        } catch {
            return 0;
        }
    }

    /**
     * (C) Resolve o valor final com prioridade:
     * 1) externalReference.finalAmount (se existir)
     * 2) baseAmount - discountAmount - cashbackUsed (se base existir)
     * 3) existingAmount (se tiver)
     * 4) webhookValue (fallback)
     *
     * Tudo em REAIS (2 casas).
     */
    public resolveFinalAmountFromExternalReference(input: {
        webhookValue: number;
        existingAmount?: number | null;
        externalReference?: string | null;
    }): number {
        const webhookValue = this.safeAmount(input.webhookValue) ?? 0;
        const existingAmount = this.safeAmount(input.existingAmount) ?? undefined;

        const parsed = this.parseAsaasExternalReference(input.externalReference);

        // 1) final pronto
        if (parsed.finalAmount !== undefined) {
            return Number(Math.max(0, parsed.finalAmount).toFixed(2));
        }

        // 2) reconstrução
        if (parsed.baseAmount !== undefined) {
            const base = parsed.baseAmount;
            const discount = parsed.discountAmount ?? 0;
            const cashback = parsed.cashbackUsed ?? 0;

            const computed = Number((base - discount - cashback).toFixed(2));
            return Number(Math.max(0, computed).toFixed(2));
        }

        // 3) local existente
        if (existingAmount !== undefined) {
            return Number(Math.max(0, existingAmount).toFixed(2));
        }

        // 4) fallback webhook
        return Number(Math.max(0, webhookValue).toFixed(2));
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
