// src/modules/payment/services/PaymentPolicy.ts

import { AppError } from "../../error/AppError";

/**
 * ---------------------------------------------------------------------
 * PAYMENT POLICY (single source of truth)
 * ---------------------------------------------------------------------
 *
 * Responsabilidades:
 * - Helpers gerais (money/date/string/plate/timezone clamp)
 * - Proteções (ensureMinimumAmount)
 * - ASAAS externalReference:
 *   • build (compact <= 100 chars)
 *   • parse (compact + retrocompat JSON legado)
 *   • resolveFinalAmountFromExternalReference (fonte de verdade no webhook)
 *
 * Observação:
 * - ASAAS limita externalReference a 100 caracteres.
 * - Se exceder, dispara erro ANTES de chamar ASAAS.
 */
export type AsaasExternalReferenceParsed = {
    userId?: number;
    planId?: number;
    couponId?: number;
    subId?: number;
    cashbackUsedAmount?: number;
    cashbackBaseAmount?: number;
    cashbackRequestedAmount?: number;
    minimumCharge?: number;
    timeZoneOffsetMinutes?: number;
};

export class PaymentPolicy {
    public static readonly MINIMUM_CHARGE_AMOUNT = 1;

    public static readonly ASAAS_EXTERNAL_REFERENCE_MAX_LEN = 100;

    // ---------------------------------------------------------------------
    // Helpers de conversão / datas
    // ---------------------------------------------------------------------

    public static toDate(value: unknown): Date | null {
        if (!value) return null;

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        const d = new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    public static isoDateString(date: Date): string {
        return new Date(date.getTime()).toISOString().split("T")[0];
    }

    public static parseIsoDateToDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (typeof value !== "string") return null;

        const trimmed = value.trim();
        if (!trimmed) return null;

        // ASAAS geralmente manda YYYY-MM-DD
        // new Date("YYYY-MM-DD") interpreta como UTC 00:00:00
        const d = new Date(trimmed);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // ---------------------------------------------------------------------
    // Helpers internos (placa, strings opcionais)
    // ---------------------------------------------------------------------

    public static normalizePlate(value: string): string {
        return (value ?? "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    }

    public static normalizeOptionalString(value: unknown): string | undefined {
        if (value === undefined || value === null) {
            return undefined;
        }

        if (typeof value !== "string") {
            return undefined;
        }

        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return undefined;
        }

        return trimmed;
    }

    // ---------------------------------------------------------------------
    // Proteções para não persistir amount <= 0 (constraint DB)
    // ---------------------------------------------------------------------

    public static ensureMinimumAmount(
        value: number,
        minimum = PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
    ): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return minimum;
        if (n <= 0) return minimum;
        return Number(n.toFixed(2));
    }

    // ---------------------------------------------------------------------
    // Helpers gerais (timezone / money)
    // ---------------------------------------------------------------------

    /**
     * Normaliza/clampa um offset em minutos (ex.: vindo do client).
     * Não calcula offset por timezone string (isso é outra responsabilidade).
     */
    public static resolveTimeZoneOffsetMinutes(
        value: unknown,
        fallback = -180,
    ): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;

        // clamp razoável de offsets globais: [-12h .. +14h] => [-720 .. +840]
        const clamped = Math.max(-720, Math.min(840, Math.trunc(n)));
        return clamped;
    }

    public static normalizeMoney(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        if (n <= 0) return 0;
        return Number(n.toFixed(2));
    }

    public static parseCashbackAmount(input: unknown): number {
        return PaymentPolicy.normalizeMoney(input);
    }

    // ---------------------------------------------------------------------
    // ASAAS externalReference (compact <= 100) + retrocompat JSON legado
    // ---------------------------------------------------------------------

    public static numberOrUndefined(value: unknown): number | undefined {
        if (value === undefined || value === null) return undefined;
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        return n;
    }

    /**
     * Formato compacto:
     *   u:1545|p:6|c:12|s:319|cb:139.9|cu:0|cr:0|mc:1|tz:-180
     *
     * Regras:
     * - Sempre <= 100 chars (ASAAS).
     * - Se exceder, lança AppError ANTES de chamar ASAAS.
     */
    public static buildAsaasExternalReference(
        data: AsaasExternalReferenceParsed,
    ): string {
        const parts: string[] = [];

        const u = PaymentPolicy.numberOrUndefined(data.userId);
        if (u !== undefined) parts.push(`u:${Math.trunc(u)}`);

        const p = PaymentPolicy.numberOrUndefined(data.planId);
        if (p !== undefined) parts.push(`p:${Math.trunc(p)}`);

        const c = PaymentPolicy.numberOrUndefined(data.couponId);
        if (c !== undefined) parts.push(`c:${Math.trunc(c)}`);

        const s = PaymentPolicy.numberOrUndefined(data.subId);
        if (s !== undefined) parts.push(`s:${Math.trunc(s)}`);

        const cb = PaymentPolicy.numberOrUndefined(data.cashbackBaseAmount);
        if (cb !== undefined) parts.push(`cb:${Number(cb.toFixed(2))}`);

        const cu = PaymentPolicy.numberOrUndefined(data.cashbackUsedAmount);
        if (cu !== undefined) parts.push(`cu:${Number(cu.toFixed(2))}`);

        const cr = PaymentPolicy.numberOrUndefined(data.cashbackRequestedAmount);
        if (cr !== undefined) parts.push(`cr:${Number(cr.toFixed(2))}`);

        const mc = PaymentPolicy.numberOrUndefined(data.minimumCharge);
        if (mc !== undefined) parts.push(`mc:${Number(mc.toFixed(2))}`);

        const tz = PaymentPolicy.numberOrUndefined(data.timeZoneOffsetMinutes);
        if (tz !== undefined) parts.push(`tz:${Math.trunc(tz)}`);

        const out = parts.join("|");

        if (out.length === 0) {
            return "";
        }

        if (out.length > PaymentPolicy.ASAAS_EXTERNAL_REFERENCE_MAX_LEN) {
            throw new AppError(
                `externalReference excede ${PaymentPolicy.ASAAS_EXTERNAL_REFERENCE_MAX_LEN} caracteres após compactação. Atual: ${out.length}`,
                500,
            );
        }

        return out;
    }

    public static parseAsaasExternalReference(
        raw: unknown,
    ): AsaasExternalReferenceParsed | null {
        if (!raw) return null;
        if (typeof raw !== "string") return null;

        const value = raw.trim();
        if (!value) return null;

        // Retrocompat: JSON antigo
        if (value.startsWith("{") && value.endsWith("}")) {
            try {
                const parsed = JSON.parse(value) as {
                    userId?: number;
                    planId?: number;
                    couponId?: number;
                    subId?: number;
                    cashbackUsedAmount?: number;
                    cashbackBaseAmount?: number;
                    cashbackRequestedAmount?: number;
                    timeZoneOffsetMinutes?: number;
                    minimumCharge?: number;
                };

                return {
                    userId: PaymentPolicy.numberOrUndefined(parsed.userId),
                    planId: PaymentPolicy.numberOrUndefined(parsed.planId),
                    couponId: PaymentPolicy.numberOrUndefined(parsed.couponId),
                    subId: PaymentPolicy.numberOrUndefined(parsed.subId),
                    cashbackUsedAmount: PaymentPolicy.numberOrUndefined(parsed.cashbackUsedAmount),
                    cashbackBaseAmount: PaymentPolicy.numberOrUndefined(parsed.cashbackBaseAmount),
                    cashbackRequestedAmount: PaymentPolicy.numberOrUndefined(parsed.cashbackRequestedAmount),
                    timeZoneOffsetMinutes: PaymentPolicy.numberOrUndefined(parsed.timeZoneOffsetMinutes),
                    minimumCharge: PaymentPolicy.numberOrUndefined(parsed.minimumCharge),
                };
            } catch {
                // cai pro modo compacto abaixo
            }
        }

        // Formato compacto: k:v|k:v
        const out: AsaasExternalReferenceParsed = {};
        const pairs = value.split("|").map((p) => p.trim()).filter(Boolean);

        for (const pair of pairs) {
            const idx = pair.indexOf(":");
            if (idx <= 0) continue;

            const k = pair.slice(0, idx).trim();
            const vRaw = pair.slice(idx + 1).trim();
            if (!vRaw) continue;

            const v = PaymentPolicy.numberOrUndefined(vRaw);
            if (v === undefined) continue;

            switch (k) {
                case "u":
                    out.userId = Math.trunc(v);
                    break;
                case "p":
                    out.planId = Math.trunc(v);
                    break;
                case "c":
                    out.couponId = Math.trunc(v);
                    break;
                case "s":
                    out.subId = Math.trunc(v);
                    break;
                case "cb":
                    out.cashbackBaseAmount = Number(v.toFixed(2));
                    break;
                case "cu":
                    out.cashbackUsedAmount = Number(v.toFixed(2));
                    break;
                case "cr":
                    out.cashbackRequestedAmount = Number(v.toFixed(2));
                    break;
                case "mc":
                    out.minimumCharge = Number(v.toFixed(2));
                    break;
                case "tz":
                    out.timeZoneOffsetMinutes = Math.trunc(v);
                    break;
                default:
                    break;
            }
        }

        return Object.keys(out).length > 0 ? out : null;
    }

    // ---------------------------------------------------------------------
    // resolveFinalAmountFromExternalReference (fonte de verdade)
    // ---------------------------------------------------------------------

    public static resolveFinalAmountFromExternalReference(params: {
        webhookValue: unknown;
        existingAmount: unknown;
        externalReference?: {
            cashbackUsedAmount?: unknown;
            cashbackBaseAmount?: unknown;
            minimumCharge?: unknown;
        } | null;
    }): number {
        const ext = params.externalReference ?? null;

        const minCharge = PaymentPolicy.ensureMinimumAmount(
            Number(ext?.minimumCharge ?? PaymentPolicy.MINIMUM_CHARGE_AMOUNT),
            PaymentPolicy.MINIMUM_CHARGE_AMOUNT,
        );

        const baseAfterCoupon = PaymentPolicy.normalizeMoney(ext?.cashbackBaseAmount);
        const cashbackUsed = PaymentPolicy.parseCashbackAmount(ext?.cashbackUsedAmount);

        // ✅ Fonte de verdade: externalReference (baseAfterCoupon - cashbackUsed) quando disponível (1ª mensalidade avulsa)
        if (baseAfterCoupon > 0) {
            const computed = baseAfterCoupon - cashbackUsed;
            return PaymentPolicy.ensureMinimumAmount(computed, minCharge);
        }

        // ✅ Fallback seguro: se já existe pagamento local com amount válido, não sobrescreve com "value" do webhook
        const existing = PaymentPolicy.normalizeMoney(params.existingAmount);
        if (existing > 0) {
            return PaymentPolicy.ensureMinimumAmount(existing, minCharge);
        }

        // ✅ Último fallback: usa o valor do webhook (mensalidades futuras da assinatura)
        const webhookValue = PaymentPolicy.normalizeMoney(params.webhookValue);
        return PaymentPolicy.ensureMinimumAmount(webhookValue, minCharge);
    }
}
