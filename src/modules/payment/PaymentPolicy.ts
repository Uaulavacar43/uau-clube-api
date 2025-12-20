// src/modules/payment/services/PaymentPolicy.ts

export class PaymentPolicy {
    public static readonly MINIMUM_CHARGE_AMOUNT = 1;

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
    // FASE 3: Proteções para não persistir amount <= 0 (constraint DB)
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
    // FASE 4: Helpers de Cashback
    // ---------------------------------------------------------------------

    public static normalizeMoney(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        if (n <= 0) return 0;
        return Number(n.toFixed(2));
    }

    public static parseCashbackAmount(input: unknown): number {
        return PaymentPolicy.normalizeMoney(input);
    }
}
