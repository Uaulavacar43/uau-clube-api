import crypto from "crypto";

export type AsaasExternalReferenceParams = {
    userId: number;
    planId: number;
    subId: number;

    // opcionais (mantém o que você usava no JSON, mas em formato curto)
    couponId?: number | null;

    cashbackUsedAmount?: number | null;
    cashbackBaseAmount?: number | null;
    cashbackRequestedAmount?: number | null;

    minimumCharge?: number | null;
    timeZoneOffsetMinutes?: number | null;
};

function shortNum(value: unknown, decimals = 2): string | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;

    // remove lixo e reduz tamanho
    const fixed = Number(n.toFixed(decimals));
    return String(fixed);
}

/**
 * externalReference (ASAAS) tem limite 100 chars.
 * Formato tokenizado, estável e parseável:
 * SUB:<subId>|U:<userId>|P:<planId>|C:<couponId>|CBU:<...>|CBB:<...>|CBR:<...>|MIN:<...>|TZ:<...>
 */
export function buildAsaasExternalReference(params: AsaasExternalReferenceParams): string {
    const userId = Number(params.userId);
    const planId = Number(params.planId);
    const subId = Number(params.subId);

    const segments: string[] = [
        `SUB:${subId}`,
        `U:${userId}`,
        `P:${planId}`,
    ];

    if (params.couponId !== undefined && params.couponId !== null) {
        segments.push(`C:${Number(params.couponId)}`);
    }

    const cbu = shortNum(params.cashbackUsedAmount);
    if (cbu !== null && Number(cbu) > 0) {
        segments.push(`CBU:${cbu}`);
    }

    const cbb = shortNum(params.cashbackBaseAmount);
    if (cbb !== null && Number(cbb) > 0) {
        segments.push(`CBB:${cbb}`);
    }

    const cbr = shortNum(params.cashbackRequestedAmount);
    if (cbr !== null && Number(cbr) > 0) {
        segments.push(`CBR:${cbr}`);
    }

    const min = shortNum(params.minimumCharge);
    if (min !== null && Number(min) > 0) {
        segments.push(`MIN:${min}`);
    }

    const tz = shortNum(params.timeZoneOffsetMinutes, 0);
    if (tz !== null && tz.length > 0) {
        segments.push(`TZ:${tz}`);
    }

    const base = segments.join("|");

    if (base.length <= 100) {
        return base;
    }

    // fallback ultra defensivo: hash + prefixo
    const hash = crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
    const truncated = base.slice(0, 80);
    return `${truncated}|H:${hash}`; // <= 100
}

export type ParsedAsaasExternalReference = {
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

/**
 * Aceita:
 * - JSON antigo: {"userId":..., "planId":..., ...}
 * - Token novo: SUB:319|U:1545|P:6|...
 */
export function parseAsaasExternalReference(raw: unknown): ParsedAsaasExternalReference | null {
    if (!raw) return null;
    if (typeof raw !== "string") return null;

    const str = raw.trim();
    if (!str) return null;

    // 1) tenta JSON (formato antigo)
    if (str.startsWith("{") || str.startsWith("[")) {
        try {
            const obj = JSON.parse(str) as any;
            return {
                userId: obj?.userId !== undefined ? Number(obj.userId) : undefined,
                planId: obj?.planId !== undefined ? Number(obj.planId) : undefined,
                couponId: obj?.couponId !== undefined && obj?.couponId !== null ? Number(obj.couponId) : undefined,
                subId: obj?.subId !== undefined ? Number(obj.subId) : undefined,

                cashbackUsedAmount: obj?.cashbackUsedAmount !== undefined ? Number(obj.cashbackUsedAmount) : undefined,
                cashbackBaseAmount: obj?.cashbackBaseAmount !== undefined ? Number(obj.cashbackBaseAmount) : undefined,
                cashbackRequestedAmount: obj?.cashbackRequestedAmount !== undefined ? Number(obj.cashbackRequestedAmount) : undefined,

                minimumCharge: obj?.minimumCharge !== undefined ? Number(obj.minimumCharge) : undefined,
                timeZoneOffsetMinutes: obj?.timeZoneOffsetMinutes !== undefined ? Number(obj.timeZoneOffsetMinutes) : undefined,
            };
        } catch {
            // cai pro token
        }
    }

    // 2) tokenizado
    const out: ParsedAsaasExternalReference = {};
    const parts = str.split("|").map((p) => p.trim()).filter(Boolean);

    for (const part of parts) {
        const idx = part.indexOf(":");
        if (idx <= 0) continue;

        const key = part.slice(0, idx).trim().toUpperCase();
        const value = part.slice(idx + 1).trim();

        const num = Number(value);
        const n = Number.isFinite(num) ? num : undefined;

        switch (key) {
            case "U":
            case "USER":
            case "USERID":
                if (n !== undefined) out.userId = n;
                break;

            case "P":
            case "PLAN":
            case "PLANID":
                if (n !== undefined) out.planId = n;
                break;

            case "SUB":
            case "SUBID":
                if (n !== undefined) out.subId = n;
                break;

            case "C":
            case "COUPON":
            case "COUPONID":
                if (n !== undefined) out.couponId = n;
                break;

            case "CBU":
                if (n !== undefined) out.cashbackUsedAmount = n;
                break;

            case "CBB":
                if (n !== undefined) out.cashbackBaseAmount = n;
                break;

            case "CBR":
                if (n !== undefined) out.cashbackRequestedAmount = n;
                break;

            case "MIN":
                if (n !== undefined) out.minimumCharge = n;
                break;

            case "TZ":
                if (n !== undefined) out.timeZoneOffsetMinutes = n;
                break;

            default:
                break;
        }
    }

    // se não trouxe nada útil
    if (
        out.userId === undefined &&
        out.planId === undefined &&
        out.subId === undefined &&
        out.couponId === undefined
    ) {
        return null;
    }

    return out;
}
