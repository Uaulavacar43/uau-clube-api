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
import prisma from "../../config/dbConfig";
import { TransactionSource, TransactionType, WalletType } from "@prisma/client";
import { asaasGetOrCreateCustomerByCpfCnpj } from "../../utils/asaas/asaasCustomer";
import { ASAAS_EVENT_STATUS_MAP } from "../../utils/asaas/asaasEventMap";
import {
    asaasCreatePayment,
    asaasGetPayment,
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
import {
    ASAASWebhookEventEnum,
    type ASAASWebhookEvent,
} from "../../utils/asaas/types/webhookTypes";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";
import { ReferralBonusService } from "../referrals/ReferralBonusService";

/**
 * ---------------------------------------------------------------------
 * Tipos internos para MODIFIERS do ASAAS (Fase 4 pronta)
 * ---------------------------------------------------------------------
 *
 * - discount: usado para cupom + cashback (Fase 4)
 * - fine/interest: previstos para fase 4+ (sem refatorar depois)
 */
type AsaasDiscountType = "PERCENTAGE" | "FIXED";

type AsaasDiscountPayload = {
    value: number;
    dueDateLimitDays?: number;
    type: AsaasDiscountType;
};

type AsaasFineType = "PERCENTAGE" | "FIXED";
type AsaasFinePayload = {
    value: number;
    type: AsaasFineType;
};

type AsaasInterestPayload = {
    value: number;
};

type AsaasBillingModifiers = {
    discount?: AsaasDiscountPayload;
    fine?: AsaasFinePayload;
    interest?: AsaasInterestPayload;
};

// Para tipar payloads diretamente a partir das funções util (evita “type: string”)
type AsaasCreatePaymentPayload = Parameters<typeof asaasCreatePayment>[0];

type CouponPricingResult = {
    finalAmount: number;
    asaasDiscount?: AsaasDiscountPayload;
    appliedDiscountValue: number;
};

/**
 * ---------------------------------------------------------------------
 * EXTERNAL REFERENCE (ASAAS) - CORREÇÃO DO LIMITE 100 CARACTERES
 * ---------------------------------------------------------------------
 *
 * O ASAAS limita o campo `externalReference` a 100 caracteres.
 * Antes era JSON.stringify(...) e estourava.
 *
 * Agora usamos formato compacto:
 *   u:1545|p:6|c:12|s:319|cb:139.9|cu:0|cr:0|mc:1|tz:-180
 *
 * Regras:
 * - Sempre <= 100 chars, senão dispara erro ANTES de chamar ASAAS.
 * - Webhooks continuam aceitando JSON antigo (retrocompatível).
 */
type AsaasExternalReferenceParsed = {
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

export class PaymentService {
    private static readonly MINIMUM_CHARGE_AMOUNT = 1;

    private static readonly ASAAS_EXTERNAL_REFERENCE_MAX_LEN = 100;

    constructor(
        private readonly paymentRepository: IPaymentRepository,
        private readonly planRepository: IPlanRepository,
        private readonly userRepository: IUserRepository,
        private readonly couponRepository: ICouponRepository,
        private readonly subscriptionRepository: ISubscriptionRepository,
        private readonly washServiceRepository: IWashServiceRepository,
        private readonly individualServicePurchaseRepository: IIndividualServicePurchaseRepository,
        private readonly carRepository: IUserCarRepository,
        private readonly referralBonusService: ReferralBonusService,
    ) {}

    // ---------------------------------------------------------------------
    // Hydration helpers (garante entidade com métodos de domínio e Dates)
    // ---------------------------------------------------------------------

    private toDate(value: unknown): Date | null {
        if (!value) return null;

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        const d = new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    private isoDateString(date: Date): string {
        return new Date(date.getTime()).toISOString().split("T")[0];
    }

    private parseIsoDateToDate(value: unknown): Date | null {
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

    /**
     * Converte um "raw" (retorno de ORM/repo) em instância de Subscription,
     * garantindo disponibilidade dos métodos:
     * - isCurrentlyActive()
     * - isExpired()
     * - isCanceled()
     */
    private hydrateSubscription(raw: any): Subscription {
        if (!raw) {
            throw new AppError("Assinatura inválida (objeto nulo)", 500);
        }

        if (raw instanceof Subscription) {
            return raw;
        }

        const createdAt = this.toDate(raw?.createdAt) ?? new Date();
        const startDate =
            this.toDate(raw?.startDate) ??
            this.toDate(raw?.createdAt) ??
            new Date();

        const updatedAt = this.toDate(raw?.updatedAt) ?? createdAt;
        const expiresAt = this.toDate(raw?.expiresAt);
        const endDate = this.toDate(raw?.endDate);

        const planType: PeriodicityType =
            raw?.planType ??
            raw?.plan?.periodicityType ??
            PeriodicityType.MONTH;

        const subscriptionStatus =
            raw?.subscriptionStatus ??
            (raw?.isActive ? "ACTIVE" : "SUSPENDED");

        return new Subscription({
            id: raw?.id ?? 0,
            userId: raw?.userId,
            carId: raw?.carId ?? undefined,
            planId: raw?.planId ?? undefined,
            planType,
            amount: raw?.amount ?? 0,
            isActive: raw?.isActive ?? false,
            startDate,
            endDate,
            createdAt,
            updatedAt,
            expiresAt,
            paymentMethod: raw?.paymentMethod ?? "UNKNOWN",
            subscriptionIdAsaas: raw?.subscriptionIdAsaas ?? null,
            installmentIdAsaas: raw?.installmentIdAsaas ?? null,
            couponId: raw?.couponId ?? null,
            coupon: raw?.coupon ?? null,
            car: raw?.car ?? null,
            plan: raw?.plan ?? null,
            subscriptionStatus,
        });
    }

    // ---------------------------------------------------------------------
    // Helpers internos (placa, status e tipos de plano)
    // ---------------------------------------------------------------------

    private normalizePlate(value: string): string {
        return (value ?? "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    }

    private normalizeOptionalString(value: unknown): string | undefined {
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

    private resolvePaymentType(
        type: CreatePaymentDTO["type"],
    ): "creditCard" | "pix" {
        return (type ?? "creditCard") === "pix" ? "pix" : "creditCard";
    }

    private mapAsaasPaymentStatusToInternal(
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

    private isClosedPackagePlan(plan: Plan): boolean {
        return plan.isPackage === true;
    }

    // ---------------------------------------------------------------------
    // FASE 3: Proteções para não persistir amount <= 0 (constraint DB)
    // ---------------------------------------------------------------------

    private ensureMinimumAmount(
        value: number,
        minimum = PaymentService.MINIMUM_CHARGE_AMOUNT,
    ): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return minimum;
        if (n <= 0) return minimum;
        return Number(n.toFixed(2));
    }

    // ---------------------------------------------------------------------
    // Helpers gerais (timezone / money)
    // ---------------------------------------------------------------------

    private resolveTimeZoneOffsetMinutes(value: unknown, fallback = -180): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;

        // clamp razoável de offsets globais: [-12h .. +14h] => [-720 .. +840]
        const clamped = Math.max(-720, Math.min(840, Math.trunc(n)));
        return clamped;
    }

    // ---------------------------------------------------------------------
    // EXTERNAL REFERENCE (ASAAS) - compact encode/decode + retrocompat JSON
    // ---------------------------------------------------------------------

    private numberOrUndefined(value: unknown): number | undefined {
        if (value === undefined || value === null) return undefined;
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        return n;
    }

    private buildAsaasExternalReference(data: AsaasExternalReferenceParsed): string {
        const parts: string[] = [];

        const u = this.numberOrUndefined(data.userId);
        if (u !== undefined) parts.push(`u:${Math.trunc(u)}`);

        const p = this.numberOrUndefined(data.planId);
        if (p !== undefined) parts.push(`p:${Math.trunc(p)}`);

        const c = this.numberOrUndefined(data.couponId);
        if (c !== undefined) parts.push(`c:${Math.trunc(c)}`);

        const s = this.numberOrUndefined(data.subId);
        if (s !== undefined) parts.push(`s:${Math.trunc(s)}`);

        const cb = this.numberOrUndefined(data.cashbackBaseAmount);
        if (cb !== undefined) parts.push(`cb:${Number(cb.toFixed(2))}`);

        const cu = this.numberOrUndefined(data.cashbackUsedAmount);
        if (cu !== undefined) parts.push(`cu:${Number(cu.toFixed(2))}`);

        const cr = this.numberOrUndefined(data.cashbackRequestedAmount);
        if (cr !== undefined) parts.push(`cr:${Number(cr.toFixed(2))}`);

        const mc = this.numberOrUndefined(data.minimumCharge);
        if (mc !== undefined) parts.push(`mc:${Number(mc.toFixed(2))}`);

        const tz = this.numberOrUndefined(data.timeZoneOffsetMinutes);
        if (tz !== undefined) parts.push(`tz:${Math.trunc(tz)}`);

        const out = parts.join("|");

        if (out.length === 0) {
            return "";
        }

        if (out.length > PaymentService.ASAAS_EXTERNAL_REFERENCE_MAX_LEN) {
            throw new AppError(
                `externalReference excede ${PaymentService.ASAAS_EXTERNAL_REFERENCE_MAX_LEN} caracteres após compactação. Atual: ${out.length}`,
                500,
            );
        }

        return out;
    }

    private parseAsaasExternalReference(raw: unknown): AsaasExternalReferenceParsed | null {
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
                    userId: this.numberOrUndefined(parsed.userId),
                    planId: this.numberOrUndefined(parsed.planId),
                    couponId: this.numberOrUndefined(parsed.couponId),
                    subId: this.numberOrUndefined(parsed.subId),
                    cashbackUsedAmount: this.numberOrUndefined(parsed.cashbackUsedAmount),
                    cashbackBaseAmount: this.numberOrUndefined(parsed.cashbackBaseAmount),
                    cashbackRequestedAmount: this.numberOrUndefined(parsed.cashbackRequestedAmount),
                    timeZoneOffsetMinutes: this.numberOrUndefined(parsed.timeZoneOffsetMinutes),
                    minimumCharge: this.numberOrUndefined(parsed.minimumCharge),
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

            const v = this.numberOrUndefined(vRaw);
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
    // FASE 4: Helpers de Cashback (saldo disponível com expiração + regra 50%)
    // ---------------------------------------------------------------------

    private normalizeMoney(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        if (n <= 0) return 0;
        return Number(n.toFixed(2));
    }

    private parseCashbackAmount(input: unknown): number {
        return this.normalizeMoney(input);
    }

    private async computeCashbackAvailability(userId: number, now: Date): Promise<{
        earnedValid: number;
        earnedExpired: number;
        usedTotal: number;
        availableBalance: number;
    }> {
        const rows = await prisma.cashbackTransaction.findMany({
            where: { userId },
            select: {
                type: true,
                amount: true,
                expiresAt: true,
            },
        });

        let earnedValid = 0;
        let earnedExpired = 0;
        let usedTotal = 0;

        for (const tx of rows) {
            const amount = Number(tx.amount ?? 0);

            if (tx.type === TransactionType.EARNED) {
                const expiresAt = tx.expiresAt ? new Date(tx.expiresAt) : null;
                const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;

                if (isExpired) earnedExpired += amount;
                else earnedValid += amount;
            }

            if (tx.type === TransactionType.USED) {
                usedTotal += amount;
            }
        }

        const rawAvailable = earnedValid - usedTotal;
        const availableBalance = rawAvailable < 0 ? 0 : Number(rawAvailable.toFixed(2));

        return {
            earnedValid: Number(earnedValid.toFixed(2)),
            earnedExpired: Number(earnedExpired.toFixed(2)),
            usedTotal: Number(usedTotal.toFixed(2)),
            availableBalance,
        };
    }

    private async getOrCreateInternalWalletByUserId(userId: number): Promise<{
        id: number;
        userId: number;
        type: WalletType;
        balance: number;
    }> {
        const wallet = await prisma.cashbackWallet.upsert({
            where: {
                userId_type: {
                    userId,
                    type: WalletType.INTERNAL,
                },
            },
            update: {},
            create: {
                userId,
                type: WalletType.INTERNAL,
                balance: 0,
            },
            select: {
                id: true,
                userId: true,
                type: true,
                balance: true,
            },
        });

        return {
            id: wallet.id,
            userId: wallet.userId,
            type: wallet.type,
            balance: Number(wallet.balance ?? 0),
        };
    }

    /**
     * Regra de cashback aplicada NO MOMENTO DE CRIAÇÃO DA COBRANÇA:
     * - não deixa o pagamento ficar abaixo do mínimo
     * - limita cashback em 50% do total (após cupom)
     * - usa saldo disponível real (earned válido - used), respeitando expiresAt
     *
     * Importante: aqui NÃO debita do wallet (apenas calcula e persiste em Payment.cashbackUsedAmount).
     * O débito acontece no webhook quando PAID (idempotente).
     */
    private async resolveCashbackUsageOrThrow(params: {
        userId: number;
        requestedCashback: number;
        amountAfterCoupon: number; // total após cupom, antes do cashback
        minimumCharge: number;
    }): Promise<{
        cashbackUsed: number;
        amountAfterCashback: number;
        wallet: { id: number; balance: number };
        availableBalance: number;
    }> {
        const requested = this.parseCashbackAmount(params.requestedCashback);

        const minCharge = this.ensureMinimumAmount(
            params.minimumCharge,
            PaymentService.MINIMUM_CHARGE_AMOUNT,
        );

        const amountAfterCoupon = this.ensureMinimumAmount(params.amountAfterCoupon, minCharge);

        if (requested <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: 0, balance: 0 },
                availableBalance: 0,
            };
        }

        const wallet = await this.getOrCreateInternalWalletByUserId(params.userId);

        const now = new Date();
        const availability = await this.computeCashbackAvailability(params.userId, now);

        if (availability.availableBalance <= 0) {
            throw new AppError("Saldo de cashback indisponível", 400);
        }

        // Regra 1: não pode reduzir abaixo do mínimo
        const maxByMinCharge = Math.max(0, amountAfterCoupon - minCharge);

        // Regra 2: 50% do total (após cupom)
        const maxByRule50 = Math.max(0, amountAfterCoupon * 0.5);

        // Limite final
        const maxAllowed = Math.min(maxByMinCharge, maxByRule50);

        if (maxAllowed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: wallet.balance },
                availableBalance: availability.availableBalance,
            };
        }

        const cashbackUsed = Math.min(
            availability.availableBalance,
            requested,
            maxAllowed,
        );

        if (cashbackUsed <= 0) {
            return {
                cashbackUsed: 0,
                amountAfterCashback: amountAfterCoupon,
                wallet: { id: wallet.id, balance: wallet.balance },
                availableBalance: availability.availableBalance,
            };
        }

        const amountAfterCashback = this.ensureMinimumAmount(
            amountAfterCoupon - cashbackUsed,
            minCharge,
        );

        return {
            cashbackUsed: Number(cashbackUsed.toFixed(2)),
            amountAfterCashback,
            wallet: { id: wallet.id, balance: wallet.balance },
            availableBalance: availability.availableBalance,
        };
    }

    /**
     * Débito idempotente no PAID:
     * - Usa eventKey único por paymentIdAsaas
     * - Verifica saldo disponível real (respeitando expiresAt)
     * - Decrementa wallet e registra CashbackTransaction.USED
     */
    private async debitCashbackIdempotentOnPaid(params: {
        userId: number;
        amount: number;
        paymentIdAsaas: string;
        paymentIdLocal?: number | null;
        meta?: Record<string, any>;
    }): Promise<void> {
        const amountToDebit = this.parseCashbackAmount(params.amount);
        if (amountToDebit <= 0) return;

        const eventKey = `CASHBACK_DEBIT:ASAAS_PAYMENT:${params.paymentIdAsaas}`;

        await prisma.$transaction(async (tx) => {
            const wallet = await tx.cashbackWallet.upsert({
                where: {
                    userId_type: {
                        userId: params.userId,
                        type: WalletType.INTERNAL,
                    },
                },
                update: {},
                create: {
                    userId: params.userId,
                    type: WalletType.INTERNAL,
                    balance: 0,
                },
                select: {
                    id: true,
                    balance: true,
                },
            });

            const existingTx = await tx.cashbackTransaction.findUnique({
                where: { eventKey },
                select: { id: true },
            });

            if (existingTx) {
                return;
            }

            const now = new Date();

            const userTxs = await tx.cashbackTransaction.findMany({
                where: { userId: params.userId },
                select: {
                    type: true,
                    amount: true,
                    expiresAt: true,
                },
            });

            let earnedValid = 0;
            let usedTotal = 0;

            for (const t of userTxs) {
                const a = Number(t.amount ?? 0);

                if (t.type === TransactionType.EARNED) {
                    const expiresAt = t.expiresAt ? new Date(t.expiresAt) : null;
                    const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
                    if (!isExpired) earnedValid += a;
                }

                if (t.type === TransactionType.USED) {
                    usedTotal += a;
                }
            }

            const availableBalance = Math.max(0, earnedValid - usedTotal);

            const walletBalance = Number(wallet.balance ?? 0);

            if (availableBalance < amountToDebit) {
                throw new AppError(
                    "Saldo de cashback insuficiente (saldo disponível real) para debitar no pagamento confirmado",
                    409,
                );
            }

            if (walletBalance < amountToDebit) {
                throw new AppError(
                    "Saldo de wallet insuficiente para debitar no pagamento confirmado",
                    409,
                );
            }

            await tx.cashbackWallet.update({
                where: { id: wallet.id },
                data: {
                    balance: {
                        decrement: amountToDebit,
                    },
                },
            });

            await tx.cashbackTransaction.create({
                data: {
                    userId: params.userId,
                    type: TransactionType.USED,
                    source: TransactionSource.SUBSCRIPTION_DEBIT,
                    amount: amountToDebit,
                    relatedId: params.paymentIdAsaas,
                    eventKey,
                    meta: {
                        paymentIdLocal: params.paymentIdLocal ?? null,
                        paymentIdAsaas: params.paymentIdAsaas,
                        ...(params.meta ?? {}),
                    },
                    expiresAt: null,
                },
            });
        });
    }

    // ---------------------------------------------------------------------
    // Helper para montar “modifiers” do ASAAS
    // ---------------------------------------------------------------------

    private buildAsaasBillingModifiers(
        mod: AsaasBillingModifiers,
    ): Partial<AsaasBillingModifiers> {
        const out: AsaasBillingModifiers = {};

        if (mod.discount) out.discount = mod.discount;
        if (mod.fine) out.fine = mod.fine;
        if (mod.interest) out.interest = mod.interest;

        return out;
    }

    // ---------------------------------------------------------------------
    // REGRA DE CUPOM (mínimo a pagar) + valor aplicado
    // ---------------------------------------------------------------------

    private applyCouponWithMinimumCharge(
        baseAmount: number,
        coupon: Coupon | null,
        minimumCharge: number = PaymentService.MINIMUM_CHARGE_AMOUNT,
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
            PaymentService.MINIMUM_CHARGE_AMOUNT,
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

    private buildCombinedAsaasDiscountFixed(params: {
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

        const minCharge = this.ensureMinimumAmount(params.minimumCharge);

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
    // Pagamento avulso (serviços individuais)
    // ---------------------------------------------------------------------

    public async createPayment(
        data: CreatePaymentDTO,
        userId: number,
    ): Promise<{
        payment: Payment;
        individualPurchases: IndividualServicePurchase[];
        services: { id: number; name: string; price: number }[];
        amount: number;
        asaasCustomer: { id: string };
        coupon: Coupon | null;
        lockedUser: { id: number };
    }> {
        const loggedUser = await this.userRepository.findById(userId);
        if (!loggedUser) {
            throw new AppError("Usuário não encontrado", 404);
        }

        const paymentType = this.resolvePaymentType(data.type);

        const creditCard =
            paymentType === "creditCard" ? data.creditCard : undefined;

        const creditCardHolderInfo =
            paymentType === "creditCard" ? data.creditCardHolderInfo : undefined;

        if (paymentType === "creditCard" && !creditCard) {
            throw new AppError("Faltam informações cartão", 400);
        }

        if (paymentType === "creditCard" && !creditCardHolderInfo) {
            throw new AppError("Faltam informações do titular do cartão", 400);
        }

        const cpfFromHolder = this.normalizeOptionalString(
            creditCardHolderInfo?.cpfCnpj,
        );
        const cpfFromPayload = this.normalizeOptionalString((data as any)?.cpf);
        const cpfFromUser = this.normalizeOptionalString((loggedUser as any)?.cpf);

        const cpf = cpfFromHolder ?? cpfFromPayload ?? cpfFromUser;

        if (!cpf) {
            throw new AppError(
                "O CPF do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const services =
            await this.washServiceRepository.findManyByIds(data.washServices);
        if (services.length === 0) {
            throw new AppError("Nenhum serviço de lavagem foi encontrado", 404);
        }

        const coupon = await this.validateCoupon(
            this.normalizeOptionalString((data as any)?.coupon),
            undefined,
            data.washServices,
        );

        const baseAmount = services.reduce(
            (total, service) => total + service.price,
            0,
        );

        const pricing = this.applyCouponWithMinimumCharge(
            baseAmount,
            coupon,
            PaymentService.MINIMUM_CHARGE_AMOUNT,
        );

        const requestedCashback = this.parseCashbackAmount((data as any)?.cashbackAmount);

        const cashbackPricing = await this.resolveCashbackUsageOrThrow({
            userId,
            requestedCashback,
            amountAfterCoupon: pricing.finalAmount,
            minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
        });

        const amount = this.ensureMinimumAmount(cashbackPricing.amountAfterCashback);

        const billingType =
            paymentType === "pix"
                ? ASAASPaymentBillingTypeEnum.PIX
                : ASAASPaymentBillingTypeEnum.CREDIT_CARD;

        const customerName =
            this.normalizeOptionalString(creditCardHolderInfo?.name) ??
            this.normalizeOptionalString((loggedUser as any)?.name);

        const customerEmail =
            this.normalizeOptionalString(creditCardHolderInfo?.email) ??
            this.normalizeOptionalString((loggedUser as any)?.email);

        if (!customerName) {
            throw new AppError(
                "O nome do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        if (!customerEmail) {
            throw new AppError(
                "O e-mail do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const customerPhone =
            this.normalizeOptionalString(creditCardHolderInfo?.phone) ??
            this.normalizeOptionalString((loggedUser as any)?.phone) ??
            undefined;

        const asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
            name: customerName,
            cpfCnpj: cpf,
            email: customerEmail,
            phone: customerPhone,
            notificationDisabled: true,
        });

        if (billingType === ASAASPaymentBillingTypeEnum.PIX) {
            await asaasGetOrCreateRandomPixKey();
        }

        const combinedDiscount = this.buildCombinedAsaasDiscountFixed({
            baseAmount,
            appliedCouponDiscountValue: pricing.appliedDiscountValue,
            cashbackUsed: cashbackPricing.cashbackUsed,
            minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
        });

        const modifiers = this.buildAsaasBillingModifiers({
            discount: combinedDiscount,
        });

        // ✅ Padroniza “data do dia” com timezone (evita virar o dia por UTC)
        const timeZoneOffsetMinutes = this.resolveTimeZoneOffsetMinutes(
            (data as any)?.timeZoneOffsetMinutes ?? (data as any)?.timeZoneOffset,
            -180,
        );
        const dateWithTimeZone = new Date();
        dateWithTimeZone.setMinutes(dateWithTimeZone.getMinutes() + timeZoneOffsetMinutes);

        const dueDateStr = this.isoDateString(dateWithTimeZone);
        const dueAt = this.parseIsoDateToDate(dueDateStr) ?? dateWithTimeZone;

        const externalReference = this.buildAsaasExternalReference({
            userId,
            couponId: coupon?.id,
            cashbackUsedAmount: cashbackPricing.cashbackUsed,
            cashbackBaseAmount: pricing.finalAmount, // base p/ regra 50% (após cupom)
            cashbackRequestedAmount: requestedCashback,
            minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
            timeZoneOffsetMinutes,
        });

        const asaasPaymentPayload: AsaasCreatePaymentPayload = {
            billingType,
            dueDate: dueDateStr,
            value: baseAmount,
            customer: asaasCustomer.id,
            description: `Pagamento serviços avulsos: ${services
                .map((s) => s.name)
                .join(", ")}`,
            externalReference,
            ...modifiers,
        };

        if (billingType === ASAASPaymentBillingTypeEnum.CREDIT_CARD) {
            (asaasPaymentPayload as any).creditCard = creditCard;
            (asaasPaymentPayload as any).creditCardHolderInfo = creditCardHolderInfo;
        }

        const asaasPayment = await asaasCreatePayment(asaasPaymentPayload);

        let pixQrCode: string | null = null;
        let pixPayload: string | null = null;
        if (billingType === ASAASPaymentBillingTypeEnum.PIX) {
            console.log("[createPayment] Recuperando QR code PIX...");
            const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
            pixQrCode = asaasPixCode.encodedImage;
            pixPayload = asaasPixCode.payload;
            console.log({ pixQrCode, pixPayload });
            console.log("[createPayment] QR code PIX recuperado.");
        }

        const agora = new Date();

        const internalStatusFromAsaas = this.mapAsaasPaymentStatusToInternal(
            asaasPayment.status,
        );

        const payment = await this.paymentRepository.create({
            id: 0,
            userId,
            amount,
            paymentMethodId: billingType.toString(),
            status: internalStatusFromAsaas,
            couponId: coupon?.id ?? null,
            paymentDate: agora,
            dueAt, // FASE 4: novo campo
            pixQrCode,
            pixPayload,
            createdAt: agora,
            updatedAt: agora,
            paymentIdAsaas: asaasPayment.id,
            planId: null,
            installments: null,
            cashbackUsedAmount:
                cashbackPricing.cashbackUsed > 0 ? cashbackPricing.cashbackUsed : null,
        } as any);

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
            lockedUser: { id: loggedUser.id },
        };
    }

    // ---------------------------------------------------------------------
    // Assinaturas (Planos em formato de pacote: mensal, trimestral, etc.)
    // ---------------------------------------------------------------------

    public async subscribeToPlan(
        data: CreateSubscriptionToPlanDTO,
        userId: number,
    ): Promise<{
        subscription: Subscription;
        payment: Payment | null;
        asaasPayment?: unknown;
    }> {
        console.log("[subscribeToPlan] Iniciando processo de pagamento...");

        const loggedUser = await this.userRepository.findById(userId);
        if (!loggedUser) {
            throw new AppError("Usuário não encontrado", 404);
        }

        const paymentType = this.resolvePaymentType((data as any)?.type);

        const creditCard =
            paymentType === "creditCard" ? (data as any)?.creditCard : undefined;

        const creditCardHolderInfo =
            paymentType === "creditCard"
                ? (data as any)?.creditCardHolderInfo
                : undefined;

        if (paymentType === "creditCard" && !creditCard) {
            throw new AppError("Faltam informações cartão", 400);
        }

        if (paymentType === "creditCard" && !creditCardHolderInfo) {
            throw new AppError("Faltam informações do titular do cartão", 400);
        }

        const cpfFromHolder = this.normalizeOptionalString(
            creditCardHolderInfo?.cpfCnpj,
        );
        const cpfFromPayload = this.normalizeOptionalString((data as any)?.cpf);
        const cpfFromUser = this.normalizeOptionalString((loggedUser as any)?.cpf);

        const cpf = cpfFromHolder ?? cpfFromPayload ?? cpfFromUser;
        if (!cpf) {
            throw new AppError(
                "O CPF do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const plan = await this.planRepository.findById((data as any)?.plan_id);
        if (!plan) {
            throw new AppError("Plano não encontrado", 404);
        }

        const isClosedPackagePlan = this.isClosedPackagePlan(plan);

        console.log(
            "[subscribeToPlan] Tipo de plano detectado:",
            isClosedPackagePlan ? "PACOTE_FECHADO" : "PLANO_RECORRENTE_ASAAS",
        );

        const car = await this.carRepository.findById((data as any)?.carId);
        if (!car) {
            throw new AppError("Carro não encontrado", 404);
        }

        if (
            plan.periodicityType === PeriodicityType.MONTH &&
            (data as any)?.installments &&
            (data as any)?.installments > 1
        ) {
            throw new AppError(
                "O plano mensal é cobrado à vista e não permite parcelamento em múltiplas parcelas.",
                400,
            );
        }

        const coupon = await this.validateCoupon(
            this.normalizeOptionalString((data as any)?.coupon),
            plan.id,
        );

        const hasSubscription = await this.carHasSubscription(car.licensePlate);
        if (hasSubscription) {
            throw new AppError(
                "Este carro já tem assinatura, caso queira alterar o plano do carro, cancele a assinatura atual",
                400,
            );
        }

        const billingPaymentType =
            paymentType === "pix"
                ? ASAASPaymentBillingTypeEnum.PIX
                : ASAASPaymentBillingTypeEnum.CREDIT_CARD;

        const billingSubscriptionType =
            paymentType === "pix"
                ? ASAASSubscriptionBillingTypeEnum.PIX
                : ASAASSubscriptionBillingTypeEnum.CREDIT_CARD;

        if (
            billingPaymentType === ASAASPaymentBillingTypeEnum.PIX ||
            billingSubscriptionType === ASAASSubscriptionBillingTypeEnum.PIX
        ) {
            await asaasGetOrCreateRandomPixKey();
        }

        console.log("[subscribeToPlan] Criando cliente no ASAAS...");

        const customerEmail =
            this.normalizeOptionalString(creditCardHolderInfo?.email) ??
            this.normalizeOptionalString((loggedUser as any)?.email);

        const customerPhone =
            this.normalizeOptionalString(creditCardHolderInfo?.phone) ??
            this.normalizeOptionalString((loggedUser as any)?.phone) ??
            undefined;

        const customerName =
            this.normalizeOptionalString((loggedUser as any)?.name) ??
            this.normalizeOptionalString(creditCardHolderInfo?.name);

        if (!customerName) {
            throw new AppError(
                "O nome do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        if (!customerEmail) {
            throw new AppError(
                "O e-mail do usuário é obrigatório para efetuar a compra",
                400,
            );
        }

        const asaasCustomer = await asaasGetOrCreateCustomerByCpfCnpj({
            name: customerName,
            cpfCnpj: creditCardHolderInfo?.cpfCnpj ?? cpf,
            email: customerEmail,
            phone: customerPhone,
            postalCode: creditCardHolderInfo?.postalCode,
            addressNumber: creditCardHolderInfo?.addressNumber,
            mobilePhone:
                creditCardHolderInfo?.mobilePhone ??
                creditCardHolderInfo?.phone ??
                customerPhone,
            notificationDisabled: false,
        });

        console.log("[subscribeToPlan] Criando assinatura em formato de PACOTE...");

        const timeZoneOffsetMinutes = this.resolveTimeZoneOffsetMinutes(
            (data as any)?.timeZoneOffsetMinutes ?? (data as any)?.timeZoneOffset,
            -180,
        );
        const dateWithTimeZone = new Date();
        dateWithTimeZone.setMinutes(
            dateWithTimeZone.getMinutes() + timeZoneOffsetMinutes,
        );

        const planCouponPricing = this.applyCouponWithMinimumCharge(
            plan.price,
            coupon,
            PaymentService.MINIMUM_CHARGE_AMOUNT,
        );

        const requestedCashback = this.parseCashbackAmount((data as any)?.cashbackAmount);

        const cashbackPricing = await this.resolveCashbackUsageOrThrow({
            userId,
            requestedCashback,
            amountAfterCoupon: planCouponPricing.finalAmount,
            minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
        });

        if (isClosedPackagePlan) {
            console.log(
                `[subscribeToPlan] Plano no formato PACOTE FECHADO, periodicidade: ${plan.periodicityType}`,
            );

            if (
                plan.periodicityType !== PeriodicityType.MONTH &&
                billingSubscriptionType ===
                ASAASSubscriptionBillingTypeEnum.CREDIT_CARD &&
                (data as any)?.installments &&
                (data as any)?.installments > 1
            ) {
                this.validatePlanInstallments(plan, (data as any)?.installments);
            }

            const expiresAt = this.calculatePlanExpiration(plan, dateWithTimeZone);

            const subscription = await this.subscriptionRepository.create(
                new Subscription({
                    userId: loggedUser.id,
                    planId: plan.id,
                    planType: plan.periodicityType,
                    amount: plan.price,
                    isActive: false,
                    startDate: dateWithTimeZone,
                    carId: (data as any)?.carId,
                    expiresAt,
                    paymentMethod: billingPaymentType,
                    couponId: coupon?.id ?? null,
                    subscriptionStatus: "SUSPENDED",
                    endDate: null,
                }),
            );

            const combinedDiscount = this.buildCombinedAsaasDiscountFixed({
                baseAmount: plan.price,
                appliedCouponDiscountValue: planCouponPricing.appliedDiscountValue,
                cashbackUsed: cashbackPricing.cashbackUsed,
                minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
            });

            const modifiers = this.buildAsaasBillingModifiers({
                discount: combinedDiscount,
            });

            const externalReference = this.buildAsaasExternalReference({
                userId,
                couponId: coupon?.id,
                planId: plan.id,
                subId: subscription.id,
                cashbackUsedAmount: cashbackPricing.cashbackUsed,
                cashbackBaseAmount: planCouponPricing.finalAmount,
                cashbackRequestedAmount: requestedCashback,
                minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
                timeZoneOffsetMinutes,
            });

            const asaasPaymentPayload: AsaasCreatePaymentPayload = {
                billingType: billingPaymentType,
                dueDate: this.isoDateString(dateWithTimeZone),
                value: plan.price,
                installmentCount:
                    plan.periodicityType !== PeriodicityType.MONTH &&
                    (data as any)?.installments &&
                    (data as any)?.installments > 1
                        ? (data as any)?.installments
                        : undefined,
                totalValue:
                    plan.periodicityType !== PeriodicityType.MONTH &&
                    (data as any)?.installments &&
                    (data as any)?.installments > 1
                        ? plan.price
                        : undefined,
                customer: asaasCustomer.id,
                description: `Pagamento plano no formato PACOTE: ${plan.name}`,
                externalReference,
                ...modifiers,
            };

            if (billingPaymentType === ASAASPaymentBillingTypeEnum.CREDIT_CARD) {
                (asaasPaymentPayload as any).creditCard = creditCard;
                (asaasPaymentPayload as any).creditCardHolderInfo = creditCardHolderInfo;
            }

            const asaasPayment = await asaasCreatePayment(asaasPaymentPayload);

            subscription.installmentIdAsaas = asaasPayment.installment
                ? asaasPayment.installment
                : null;

            const finalStatus = this.mapAsaasPaymentStatusToInternal(
                asaasPayment.status as ASAASPaymentStatusEnum,
            );

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;

            if (billingPaymentType === ASAASPaymentBillingTypeEnum.PIX) {
                console.log(
                    "[subscribeToPlan] Recuperando QR code PIX para PACOTE FECHADO...",
                );
                const asaasPixCode = await asaasGetPixQrCode(asaasPayment.id);
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log({ pixQrCode, pixPayload });
                console.log("[subscribeToPlan] QR code PIX recuperado.");
            }

            const safeFinalAmount = this.ensureMinimumAmount(
                cashbackPricing.amountAfterCashback,
                PaymentService.MINIMUM_CHARGE_AMOUNT,
            );

            const payment = await this.paymentRepository.create({
                id: 0,
                userId,
                planId: plan.id,
                amount: safeFinalAmount,
                status: finalStatus,
                installments:
                    plan.periodicityType !== PeriodicityType.MONTH
                        ? (data as any)?.installments ?? null
                        : null,
                paymentDate: dateWithTimeZone,
                dueAt: this.parseIsoDateToDate(this.isoDateString(dateWithTimeZone)) ?? dateWithTimeZone,
                createdAt: dateWithTimeZone,
                updatedAt: dateWithTimeZone,
                paymentIdAsaas: asaasPayment.id,
                couponId: coupon?.id ?? null,
                pixQrCode,
                pixPayload,
                paymentMethodId: billingPaymentType.toString(),
                cashbackUsedAmount:
                    cashbackPricing.cashbackUsed > 0 ? cashbackPricing.cashbackUsed : null,
            } as any);

            let createdSubscription: Subscription;

            if (finalStatus === "PAID") {
                await this.updateSubscriptionValidityFromPayment(
                    subscription,
                    dateWithTimeZone,
                    "PAID",
                );
                createdSubscription = subscription;
            } else {
                const updatedRaw = await this.subscriptionRepository.update(
                    subscription.id,
                    subscription,
                );
                createdSubscription = this.hydrateSubscription(updatedRaw);
            }

            return {
                subscription: createdSubscription,
                payment,
                asaasPayment,
            };
        }

        console.log(
            "[subscribeToPlan] Plano NÃO é pacote. Criando assinatura ASAAS recorrente...",
        );

        const { subscription, payment } = await this.createAsaasSubscription(
            {
                ...(data as any),
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
            "[subscribeToPlan] Assinatura criada no ASAAS (recorrente):",
            subscription.subscriptionIdAsaas ?? "(sem subscriptionIdAsaas)",
        );

        return {
            subscription: subscription as Subscription,
            payment,
        };
    }

    // ---------------------------------------------------------------------
    // Validações de cupom / parcelas
    // ---------------------------------------------------------------------

    private async validateCoupon(
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

    private validatePlanInstallments(plan: Plan, installments?: number): true {
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

        if (plan.periodicityType === PeriodicityType.YEAR && installments > 12) {
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

    // ---------------------------------------------------------------------
    // Webhook ASAAS
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

    private resolveInternalStatus(
        event: ASAASWebhookEventEnum,
    ): "PAID" | "PENDING" | "CANCELED" | undefined {
        const mapped = ASAAS_EVENT_STATUS_MAP[event];
        if (mapped) {
            return mapped;
        }
        return this.mapEventToInternalStatus(event);
    }

    public async paymentWebhook(body: ASAASWebhookEvent): Promise<{
        status: number;
        message: string;
        newStatus?: "PAID" | "PENDING" | "CANCELED";
        error?: unknown;
    }> {
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

            const newStatus = this.resolveInternalStatus(event);

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

            return {
                status: 200,
                message: "Webhook processado com sucesso",
                newStatus,
            };
        } catch (error) {
            console.error("[paymentWebhook] Erro inesperado:", error);
            return { status: 200, message: "Erro interno", error };
        }
    }

    private async carHasSubscription(licensePlate: string): Promise<boolean> {
        const normalizedPlate = this.normalizePlate(licensePlate);

        if (!normalizedPlate) {
            return false;
        }

        const existingRaw =
            await this.subscriptionRepository.findByCarLicensePlate(
                normalizedPlate,
            );

        if (!existingRaw) {
            return false;
        }

        const existing = this.hydrateSubscription(existingRaw);
        return existing.isCurrentlyActive();
    }

    private async findLastPaidPlanPaymentForUser(
        userId: number,
    ): Promise<Payment | null> {
        try {
            const payments = await this.paymentRepository.getAll({ userId });

            if (payments.length === 0) {
                console.log(
                    `[findLastPaidPlanPaymentForUser] Nenhum pagamento encontrado para userId=${userId}.`,
                );
                return null;
            }

            const sorted = [...payments].sort((a, b) => {
                const aDate =
                    (a.paymentDate ?? a.createdAt ?? new Date(0)).getTime();
                const bDate =
                    (b.paymentDate ?? b.createdAt ?? new Date(0)).getTime();
                return bDate - aDate;
            });

            const lastPaidWithPlan = sorted.find(
                (paymentItem) =>
                    paymentItem.status === "PAID" &&
                    paymentItem.planId !== undefined &&
                    paymentItem.planId !== null,
            );

            if (!lastPaidWithPlan) {
                console.log(
                    `[findLastPaidPlanPaymentForUser] Nenhum pagamento PAID com plano encontrado para userId=${userId}.`,
                );
                return null;
            }

            return lastPaidWithPlan;
        } catch (error) {
            console.error(
                `[findLastPaidPlanPaymentForUser] Erro ao buscar pagamento PAID para userId=${userId}:`,
                error,
            );
            return null;
        }
    }

    public async ensureSubscriptionForUserAndCarFromExistingPayments(
        userId: number,
        carId: number,
    ): Promise<void> {
        const car = await this.carRepository.findById(carId);

        if (!car) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Carro ${carId} não encontrado para userId=${userId}.`,
            );
            return;
        }

        const normalizedPlate = this.normalizePlate(car.licensePlate);

        if (!normalizedPlate) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Carro ${carId} sem placa válida para userId=${userId}.`,
            );
            return;
        }

        const subscriptionByPlateRaw =
            await this.subscriptionRepository.findByCarLicensePlate(
                normalizedPlate,
            );

        if (subscriptionByPlateRaw) {
            const subscriptionByPlate =
                this.hydrateSubscription(subscriptionByPlateRaw);

            if (subscriptionByPlate.userId !== userId) {
                console.warn(
                    `[ensureSubscriptionForUserAndCarFromExistingPayments] Atenção: assinatura encontrada por placa ${normalizedPlate} pertence a outro usuário (subscription.userId=${subscriptionByPlate.userId}, userId=${userId}). Não vinculando carId.`,
                );
                return;
            }

            if (
                subscriptionByPlate.carId === undefined ||
                subscriptionByPlate.carId === null
            ) {
                subscriptionByPlate.carId = carId;

                await this.subscriptionRepository.update(
                    subscriptionByPlate.id,
                    subscriptionByPlate,
                );

                console.log(
                    `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ${subscriptionByPlate.id} vinculada ao carro ${carId} pela placa ${normalizedPlate}.`,
                );
            }

            if (
                !subscriptionByPlate.isCurrentlyActive() &&
                !subscriptionByPlate.isCanceled()
            ) {
                const lastPaidPayment =
                    await this.findLastPaidPlanPaymentForUser(userId);

                if (
                    lastPaidPayment &&
                    lastPaidPayment.planId === subscriptionByPlate.planId
                ) {
                    const paymentDate =
                        lastPaidPayment.paymentDate ??
                        lastPaidPayment.createdAt ??
                        new Date();

                    await this.updateSubscriptionValidityFromPayment(
                        subscriptionByPlate,
                        paymentDate,
                        "PAID",
                    );

                    await this.subscriptionRepository.update(
                        subscriptionByPlate.id,
                        subscriptionByPlate,
                    );
                } else {
                    console.log(
                        `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ${subscriptionByPlate.id} encontrada por placa, porém sem pagamento PAID compatível (planId). Mantendo estado atual.`,
                    );
                }
            }

            return;
        }

        const userSubscriptionsRaw =
            await this.subscriptionRepository.findByUserId(userId, true);

        const userSubscriptions = userSubscriptionsRaw.map((s: any) =>
            this.hydrateSubscription(s),
        );

        const activeSubscriptionWithoutCar = userSubscriptions.find(
            (subscriptionItem) =>
                subscriptionItem.isCurrentlyActive() &&
                (subscriptionItem.carId === undefined ||
                    subscriptionItem.carId === null),
        );

        if (activeSubscriptionWithoutCar) {
            activeSubscriptionWithoutCar.carId = carId;

            await this.subscriptionRepository.update(
                activeSubscriptionWithoutCar.id,
                activeSubscriptionWithoutCar,
            );

            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura ativa ${activeSubscriptionWithoutCar.id} vinculada ao carro ${carId} para o usuário ${userId}.`,
            );

            return;
        }

        const lastPaidPayment =
            await this.findLastPaidPlanPaymentForUser(userId);

        if (
            !lastPaidPayment ||
            lastPaidPayment.planId === undefined ||
            lastPaidPayment.planId === null
        ) {
            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Nenhum pagamento PAID com plano encontrado para userId=${userId}. Nenhuma assinatura será criada.`,
            );
            return;
        }

        const plan = await this.planRepository.findById(lastPaidPayment.planId);
        if (!plan) {
            console.warn(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Plano ${lastPaidPayment.planId} não encontrado para userId=${userId}.`,
            );
            return;
        }

        const paymentDate =
            lastPaidPayment.paymentDate ??
            lastPaidPayment.createdAt ??
            new Date();

        let subscriptionForPlan = userSubscriptions.find(
            (subscriptionItem) => subscriptionItem.planId === plan.id,
        );

        if (subscriptionForPlan) {
            subscriptionForPlan.carId = carId;

            await this.updateSubscriptionValidityFromPayment(
                subscriptionForPlan,
                paymentDate,
                "PAID",
            );

            await this.subscriptionRepository.update(
                subscriptionForPlan.id,
                subscriptionForPlan,
            );

            console.log(
                `[ensureSubscriptionForUserAndCarFromExistingPayments] Assinatura existente ${subscriptionForPlan.id} atualizada a partir do pagamento e vinculada ao carro ${carId}.`,
            );

            return;
        }

        const expiresAt = this.calculatePlanExpiration(plan, paymentDate);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        const paymentMethodSafe: string =
            lastPaidPayment.paymentMethodId &&
            lastPaidPayment.paymentMethodId.trim().length > 0
                ? lastPaidPayment.paymentMethodId
                : "UNKNOWN";

        const subscription = new Subscription({
            userId,
            planId: plan.id,
            planType: plan.periodicityType,
            amount: this.ensureMinimumAmount(lastPaidPayment.amount),
            isActive,
            startDate: paymentDate,
            carId,
            expiresAt,
            paymentMethod: paymentMethodSafe,
            couponId: lastPaidPayment.couponId ?? null,
            subscriptionStatus: isActive ? "ACTIVE" : "SUSPENDED",
            endDate: isActive ? null : expiresAt,
            subscriptionIdAsaas: null,
        });

        const createdSubscriptionRaw =
            await this.subscriptionRepository.create(subscription);

        const createdSubscription =
            this.hydrateSubscription(createdSubscriptionRaw);

        console.log(
            `[ensureSubscriptionForUserAndCarFromExistingPayments] Nova assinatura ${createdSubscription.id} criada a partir do pagamento PAID e vinculada ao carro ${carId}. isActive=${createdSubscription.isActive}, expiresAt=${createdSubscription.expiresAt?.toISOString()}`,
        );
    }

    public async ensureSubscriptionWhenCarAdded(
        userId: number,
        carId: number,
    ): Promise<void> {
        await this.ensureSubscriptionForUserAndCarFromExistingPayments(
            userId,
            carId,
        );
    }

    private async createAsaasSubscription(
        data: CreateSubscriptionToPlanDTO & { userId: number },
        plan: Plan,
        customerId: string,
        coupon: Coupon | null,
        billingType: ASAASSubscriptionBillingTypeEnum,
    ): Promise<{
        subscription: Subscription;
        payment: Payment | null;
    }> {
        try {
            const mapCycle = new Map<PeriodicityType, ASAASSubscriptionCycleEnum>(
                [
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
                ],
            );

            const cycle = mapCycle.get(plan.periodicityType);
            if (!cycle) {
                throw new AppError(
                    `Este período de assinatura não existe ou não é permitido neste formato: ${plan.periodicityType}`,
                    400,
                );
            }

            const paymentType = this.resolvePaymentType((data as any)?.type);

            const creditCard =
                paymentType === "creditCard" ? (data as any)?.creditCard : undefined;

            const creditCardHolderInfo =
                paymentType === "creditCard"
                    ? (data as any)?.creditCardHolderInfo
                    : undefined;

            if (billingType === ASAASSubscriptionBillingTypeEnum.CREDIT_CARD) {
                if (!creditCard) {
                    throw new AppError("Faltam informações cartão", 400);
                }

                if (!creditCardHolderInfo) {
                    throw new AppError(
                        "Faltam informações do titular do cartão",
                        400,
                    );
                }
            }

            const timeZoneOffsetMinutes = this.resolveTimeZoneOffsetMinutes(
                (data as any)?.timeZoneOffsetMinutes ?? (data as any)?.timeZoneOffset,
                -180,
            );
            const startDate = new Date();
            startDate.setMinutes(startDate.getMinutes() + timeZoneOffsetMinutes);

            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            const localSubscriptionRaw = await this.subscriptionRepository.create(
                new Subscription({
                    userId: data.userId,
                    planId: plan.id,
                    planType: plan.periodicityType,
                    amount: plan.price,
                    isActive: false,
                    startDate,
                    carId: (data as any)?.carId,
                    paymentMethod: billingType,
                    subscriptionIdAsaas: null,
                    couponId: coupon?.id ?? null,
                    expiresAt,
                    subscriptionStatus: "SUSPENDED",
                    endDate: null,
                }),
            );

            const localSubscription =
                this.hydrateSubscription(localSubscriptionRaw);

            const planCouponPricing = this.applyCouponWithMinimumCharge(
                plan.price,
                coupon,
                PaymentService.MINIMUM_CHARGE_AMOUNT,
            );

            const requestedCashback = this.parseCashbackAmount((data as any)?.cashbackAmount);

            const cashbackPricing = await this.resolveCashbackUsageOrThrow({
                userId: data.userId,
                requestedCashback,
                amountAfterCoupon: planCouponPricing.finalAmount,
                minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
            });

            const combinedDiscount = this.buildCombinedAsaasDiscountFixed({
                baseAmount: plan.price,
                appliedCouponDiscountValue: planCouponPricing.appliedDiscountValue,
                cashbackUsed: cashbackPricing.cashbackUsed,
                minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
            });

            const modifiers = this.buildAsaasBillingModifiers({
                discount: combinedDiscount,
            });

            const externalReference = this.buildAsaasExternalReference({
                userId: data.userId,
                planId: plan.id,
                couponId: coupon?.id,
                subId: localSubscription.id,
                cashbackUsedAmount: cashbackPricing.cashbackUsed,
                cashbackBaseAmount: planCouponPricing.finalAmount,
                cashbackRequestedAmount: requestedCashback,
                minimumCharge: PaymentService.MINIMUM_CHARGE_AMOUNT,
                timeZoneOffsetMinutes,
            });

            const payload: ASAASCreateSubscriptionDTO = {
                customer: customerId,
                nextDueDate: this.isoDateString(startDate),
                value: plan.price,
                billingType,
                cycle,
                description: `Plano recorrente: ${plan.name}`,
                externalReference,
                ...modifiers,
            } as ASAASCreateSubscriptionDTO;

            if (billingType === ASAASSubscriptionBillingTypeEnum.CREDIT_CARD) {
                (payload as any).creditCard = creditCard;
                (payload as any).creditCardHolderInfo = creditCardHolderInfo;
            }

            console.log("[createAsaasSubscription] Criando assinatura no Asaas...");
            const asaasSubscription = await asaasCreateSubscription(
                payload,
                customerId,
            );

            localSubscription.subscriptionIdAsaas = asaasSubscription.id;
            localSubscription.amount = asaasSubscription.value;

            await this.subscriptionRepository.update(
                localSubscription.id,
                localSubscription,
            );

            console.log(
                `[createAsaasSubscription] Assinatura Asaas ${asaasSubscription.id} vinculada ao ID local ${localSubscription.id}.`,
            );

            console.log(
                "[createAsaasSubscription] Tentando recuperar a primeira cobrança (ID pay_...).",
            );
            const paymentList = await asaasListSubscriptionPayments(
                asaasSubscription.id,
            );

            const firstPaymentAsaas = paymentList.data[0];

            if (!firstPaymentAsaas) {
                console.warn(
                    "[createAsaasSubscription] ALERTA: Cobrança não encontrada imediatamente. O Webhook irá criar o registro de Payment e ativar o PIX/Cartão.",
                );

                return {
                    subscription: localSubscription,
                    payment: null,
                };
            }

            console.log(
                `[createAsaasSubscription] Cobrança recuperada: ${firstPaymentAsaas.id} (Status: ${firstPaymentAsaas.status})`,
            );

            let pixQrCode: string | null = null;
            let pixPayload: string | null = null;

            if (billingType === ASAASSubscriptionBillingTypeEnum.PIX) {
                console.log("[createAsaasSubscription] Recuperando QR code PIX...");
                const asaasPixCode = await asaasGetPixQrCode(
                    firstPaymentAsaas.id,
                );
                pixQrCode = asaasPixCode.encodedImage;
                pixPayload = asaasPixCode.payload;
                console.log(
                    "[createAsaasSubscription] QR code PIX recuperado e pronto para o cliente.",
                );
            }

            const internalStatus = this.mapAsaasPaymentStatusToInternal(
                firstPaymentAsaas.status as ASAASPaymentStatusEnum,
            );

            const safeFinalAmount = this.ensureMinimumAmount(
                cashbackPricing.amountAfterCashback,
                PaymentService.MINIMUM_CHARGE_AMOUNT,
            );

            const dbPayment = await this.paymentRepository.create({
                id: 0,
                userId: data.userId,
                planId: plan.id,
                couponId: coupon?.id ?? null,
                amount: safeFinalAmount,
                status: internalStatus,
                paymentMethodId: billingType.toString(),
                paymentIdAsaas: firstPaymentAsaas.id,
                paymentDate: startDate,
                dueAt: this.parseIsoDateToDate(this.isoDateString(startDate)) ?? startDate,
                createdAt: startDate,
                updatedAt: startDate,
                pixQrCode,
                pixPayload,
                installments: null,
                cashbackUsedAmount:
                    cashbackPricing.cashbackUsed > 0 ? cashbackPricing.cashbackUsed : null,
            } as any);

            if (internalStatus === "PAID") {
                console.log(
                    "[createAsaasSubscription] Pagamento APROVADO IMEDIATAMENTE. Ativando assinatura local.",
                );
                await this.updateSubscriptionValidityFromPayment(
                    localSubscription,
                    startDate,
                    "PAID",
                );
                return {
                    subscription: localSubscription,
                    payment: dbPayment,
                };
            }

            return {
                subscription: localSubscription,
                payment: dbPayment,
            };
        } catch (error) {
            console.error("[createAsaasSubscription] Erro fatal no fluxo:", error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(
                "Erro interno ao processar assinatura recorrente",
                500,
            );
        }
    }

    private async handleSubscriptionWebhook(
        body: ASAASWebhookEvent,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void | { status: number; message: string }> {
        const subscriptionAsaasId = body.subscription?.id;
        if (!subscriptionAsaasId) {
            return;
        }

        const event = body.event;

        const localSubscriptionByAsaasRaw =
            await this.subscriptionRepository.getByAsaasId(subscriptionAsaasId);

        const localSubscriptionByAsaas = localSubscriptionByAsaasRaw
            ? this.hydrateSubscription(localSubscriptionByAsaasRaw)
            : null;

        if (
            !localSubscriptionByAsaas &&
            event !== ASAASWebhookEventEnum.SUBSCRIPTION_CREATED
        ) {
            console.log(
                `[handleSubscriptionWebhook] Assinatura ${subscriptionAsaasId} não encontrada localmente.`,
            );
            return;
        }

        if (
            event === ASAASWebhookEventEnum.SUBSCRIPTION_CREATED &&
            body.subscription
        ) {
            console.info(
                `[handleSubscriptionWebhook] SUBSCRIPTION_CREATED ${body.subscription.id}`,
            );

            const externalReferenceRaw = body.subscription.externalReference ?? "";
            let externalReferenceUserId: number | undefined;
            let externalReferencePlanId: number | undefined;
            let externalReferenceCouponId: number | undefined;
            let externalReferenceSubId: number | undefined;

            if (externalReferenceRaw) {
                const parsed = this.parseAsaasExternalReference(externalReferenceRaw);
                if (parsed) {
                    externalReferenceUserId = parsed.userId;
                    externalReferencePlanId = parsed.planId;
                    externalReferenceCouponId = parsed.couponId;
                    externalReferenceSubId = parsed.subId;
                }
            }

            if (!externalReferenceUserId || !externalReferencePlanId) {
                console.error(
                    "[handleSubscriptionWebhook] userId ou planId ausentes na referência externa.",
                );
                return {
                    status: 400,
                    message: "Referência externa inválida na assinatura",
                };
            }

            const plan = await this.planRepository.findById(externalReferencePlanId);
            if (!plan) {
                console.error(
                    `[handleSubscriptionWebhook] Plano ${externalReferencePlanId} não encontrado ao processar SUBSCRIPTION_CREATED.`,
                );
                return {
                    status: 400,
                    message: "Plano da assinatura não encontrado",
                };
            }

            if (
                externalReferenceSubId !== undefined &&
                externalReferenceSubId !== null
            ) {
                const localByIdRaw = await this.subscriptionRepository.findById(
                    externalReferenceSubId,
                );

                if (localByIdRaw) {
                    const localById = this.hydrateSubscription(localByIdRaw);

                    localById.subscriptionIdAsaas = body.subscription.id;
                    localById.amount = body.subscription.value;

                    if (body.subscription.billingType) {
                        localById.paymentMethod = body.subscription.billingType;
                    }

                    await this.subscriptionRepository.update(localById.id, localById);

                    console.info(
                        `[handleSubscriptionWebhook] Subscription local ${localById.id} atualizada com subscriptionIdAsaas=${body.subscription.id}.`,
                    );

                    return {
                        status: 200,
                        message: "Assinatura vinculada ao registro local existente",
                    };
                }
            }

            const existingByAsaasRaw = await this.subscriptionRepository.getByAsaasId(
                body.subscription.id,
            );

            if (existingByAsaasRaw) {
                console.info(
                    `[handleSubscriptionWebhook] Assinatura já existe no banco por asaasId: ${body.subscription.id}`,
                );
                return { status: 200, message: "Assinatura já registrada" };
            }

            const startDate = new Date();
            const expiresAt = this.calculatePlanExpiration(plan, startDate);

            const newSubscription = new Subscription({
                userId: externalReferenceUserId,
                planId: externalReferencePlanId,
                planType: plan.periodicityType,
                amount: body.subscription.value,
                isActive: false,
                startDate,
                expiresAt,
                endDate: null,
                paymentMethod: body.subscription.billingType,
                subscriptionIdAsaas: body.subscription.id,
                couponId: externalReferenceCouponId ?? null,
                subscriptionStatus: "SUSPENDED",
            });

            await this.subscriptionRepository.create(newSubscription);

            console.info(
                `[handleSubscriptionWebhook] Assinatura criada via fallback (sem subId). asaasId=${body.subscription.id}`,
            );

            return {
                status: 200,
                message: "Assinatura registrada (fallback) aguardando pagamento",
            };
        }

        if (newStatus === "CANCELED" && localSubscriptionByAsaas) {
            localSubscriptionByAsaas.isActive = false;
            localSubscriptionByAsaas.subscriptionStatus = "CANCELED";
            localSubscriptionByAsaas.endDate = new Date();

            await this.subscriptionRepository.update(
                localSubscriptionByAsaas.id,
                localSubscriptionByAsaas,
            );

            console.info(
                `[handleSubscriptionWebhook] Assinatura ${localSubscriptionByAsaas.id} desativada por cancelamento ASAAS.`,
            );
        }
    }

    private async handlePaymentWebhook(
        body: ASAASWebhookEvent,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<{
        status: number;
        message: string;
        newStatus?: "PAID" | "PENDING" | "CANCELED";
        error?: unknown;
    }> {
        try {
            console.log("[handlePaymentWebhook] Processando webhook de pagamento...");

            if (!body.payment) {
                console.warn("[handlePaymentWebhook] body.payment está indefinido");
                return { status: 200, message: "Sem dados de pagamento" };
            }

            const paymentAsaasId = body.payment.id;
            if (!paymentAsaasId) {
                console.warn("[handlePaymentWebhook] payment.id está indefinido");
                return { status: 200, message: "ID de pagamento não encontrado" };
            }

            // ⚠️ NÃO usar isso como fonte de verdade do amount quando há discount/modifiers.
            const webhookValue = Number(body.payment.value) || 0;

            // ✅ Agora é LET: pode ser preenchido no fallback do ASAAS
            let paymentDate =
                body.payment.paymentDate !== undefined && body.payment.paymentDate !== null
                    ? new Date(body.payment.paymentDate)
                    : new Date();

            // ✅ Agora é LET: pode ser preenchido no fallback do ASAAS
            let dueAtFromBody =
                (body.payment as any)?.dueDate !== undefined && (body.payment as any)?.dueDate !== null
                    ? this.parseIsoDateToDate((body.payment as any)?.dueDate)
                    : null;

            let userId: number | undefined;
            let planId: number | undefined;
            let couponId: number | undefined;
            let subId: number | undefined;

            let cashbackUsedAmount: number | undefined;
            let cashbackBaseAmount: number | undefined;

            // ✅ novo: timezone para competência/recorrência
            let timeZoneOffsetMinutes: number | undefined;

            // ✅ novo: mínimo para clamp no webhook (vem do externalReference)
            let minimumCharge: number | undefined;

            // Mantém um objeto parseado (para recalcular amount corretamente)
            let parsedExternalReference:
                | {
                userId?: number;
                planId?: number;
                couponId?: number;
                subId?: number;
                cashbackUsedAmount?: number;
                cashbackBaseAmount?: number;
                timeZoneOffsetMinutes?: number;
                minimumCharge?: number;
            }
                | null = null;

            if (body.payment.externalReference) {
                const parsed = this.parseAsaasExternalReference(body.payment.externalReference);
                if (parsed) {
                    parsedExternalReference = {
                        userId: parsed.userId,
                        planId: parsed.planId,
                        couponId: parsed.couponId,
                        subId: parsed.subId,
                        cashbackUsedAmount: parsed.cashbackUsedAmount,
                        cashbackBaseAmount: parsed.cashbackBaseAmount,
                        timeZoneOffsetMinutes: parsed.timeZoneOffsetMinutes,
                        minimumCharge: parsed.minimumCharge,
                    };

                    userId = parsed.userId;
                    planId = parsed.planId;
                    couponId = parsed.couponId;
                    subId = parsed.subId;

                    cashbackUsedAmount = parsed.cashbackUsedAmount;
                    cashbackBaseAmount = parsed.cashbackBaseAmount;

                    timeZoneOffsetMinutes = parsed.timeZoneOffsetMinutes;
                    minimumCharge = parsed.minimumCharge;
                }
            }

            const resolvedTimeZoneOffsetMinutes = this.resolveTimeZoneOffsetMinutes(
                timeZoneOffsetMinutes,
                -180,
            );

            console.log(
                `[handlePaymentWebhook] userId inicial: ${userId}, planId inicial: ${planId}, couponId inicial: ${couponId}, subId inicial: ${subId}, cashbackUsedAmount inicial: ${cashbackUsedAmount}, cashbackBaseAmount inicial: ${cashbackBaseAmount}, minimumCharge inicial: ${minimumCharge}, timeZoneOffsetMinutes inicial: ${timeZoneOffsetMinutes} (resolvido=${resolvedTimeZoneOffsetMinutes})`,
            );

            if ((!userId || !planId) && body.payment.subscription) {
                console.log(
                    "[handlePaymentWebhook] Tentando resolver userId/planId via subscription (asaasId) do pagamento...",
                );
                const localSubRaw = await this.subscriptionRepository.getByAsaasId(
                    body.payment.subscription,
                );
                if (localSubRaw) {
                    const localSub = this.hydrateSubscription(localSubRaw);
                    userId = userId ?? localSub.userId;
                    planId = planId ?? (localSub.planId ?? undefined);
                    subId = subId ?? localSub.id;
                }
            }

            if ((!userId || !planId) && body.payment.installment) {
                console.log(
                    "[handlePaymentWebhook] Tentando resolver userId/planId via installment do pagamento...",
                );
                const localSubByInstallmentRaw =
                    await this.subscriptionRepository.getByInstallmentIdAsaas(
                        body.payment.installment,
                    );
                if (localSubByInstallmentRaw) {
                    const localSubByInstallment =
                        this.hydrateSubscription(localSubByInstallmentRaw);

                    userId = userId ?? localSubByInstallment.userId;
                    planId = planId ?? (localSubByInstallment.planId ?? undefined);
                    subId = subId ?? localSubByInstallment.id;
                }
            }

            if ((!userId || !planId) && subId) {
                console.log(
                    "[handlePaymentWebhook] Tentando resolver userId/planId via subId (registro local)...",
                );
                const subscriptionFromIdRaw = await this.subscriptionRepository.findById(subId);
                if (subscriptionFromIdRaw) {
                    const subscriptionFromId = this.hydrateSubscription(subscriptionFromIdRaw);

                    userId = userId ?? subscriptionFromId.userId;
                    planId = planId ?? (subscriptionFromId.planId ?? undefined);
                    subId = subscriptionFromId.id;
                }
            }

            // ✅ Busca existingPayment ANTES do cálculo do amount (pra poder preservar amount local se necessário)
            const existingPayment = await this.paymentRepository.getByAsaasId(paymentAsaasId);

            // ✅ Se ainda faltar vínculo (ou quiser enriquecer dados), consulta ASAAS
            // OBS: não exigimos planId para pagamentos avulsos, mas a consulta pode preencher dados legados.
            if (!userId || (!planId && planId !== 0)) {
                try {
                    console.log(
                        "[handlePaymentWebhook] Fallback: consultando ASAAS por payId para completar vínculo (externalReference/subscription/installment)...",
                    );

                    type AsaasPaymentLike = {
                        id: string;
                        status: ASAASPaymentStatusEnum | string;
                        subscription?: string | null;
                        installment?: string | null;
                        externalReference?: string | null;
                        billingType?: string | null;
                        value?: number | string | null;
                        paymentDate?: string | null;
                        dueDate?: string | null;
                    };

                    const asaasPaymentRaw = await asaasGetPayment(paymentAsaasId);
                    const asaasPayment = asaasPaymentRaw as AsaasPaymentLike;

                    // ✅ Se o webhook veio sem paymentDate, tenta preencher do ASAAS
                    if (
                        (body.payment.paymentDate === undefined || body.payment.paymentDate === null) &&
                        asaasPayment.paymentDate
                    ) {
                        body.payment.paymentDate = asaasPayment.paymentDate as any;
                        paymentDate = new Date(asaasPayment.paymentDate);
                    }

                    // ✅ Se o webhook veio sem dueDate, tenta preencher do ASAAS
                    if (!dueAtFromBody && asaasPayment.dueDate) {
                        (body.payment as any).dueDate = asaasPayment.dueDate;
                        dueAtFromBody = this.parseIsoDateToDate(asaasPayment.dueDate);
                    }

                    if (!body.payment.externalReference && asaasPayment.externalReference) {
                        body.payment.externalReference = asaasPayment.externalReference;

                        const parsed = this.parseAsaasExternalReference(asaasPayment.externalReference);
                        if (parsed) {
                            parsedExternalReference = {
                                userId: parsed.userId,
                                planId: parsed.planId,
                                couponId: parsed.couponId,
                                subId: parsed.subId,
                                cashbackUsedAmount: parsed.cashbackUsedAmount,
                                cashbackBaseAmount: parsed.cashbackBaseAmount,
                                timeZoneOffsetMinutes: parsed.timeZoneOffsetMinutes,
                                minimumCharge: parsed.minimumCharge,
                            };

                            userId = userId ?? parsed.userId;
                            planId = planId ?? parsed.planId;
                            couponId = couponId ?? parsed.couponId;
                            subId = subId ?? parsed.subId;

                            cashbackUsedAmount = cashbackUsedAmount ?? parsed.cashbackUsedAmount;
                            cashbackBaseAmount = cashbackBaseAmount ?? parsed.cashbackBaseAmount;

                            timeZoneOffsetMinutes = timeZoneOffsetMinutes ?? parsed.timeZoneOffsetMinutes;
                            minimumCharge = minimumCharge ?? parsed.minimumCharge;
                        }
                    }

                    const subscriptionAsaasId =
                        body.payment.subscription ?? asaasPayment.subscription ?? undefined;

                    const installmentAsaasId =
                        body.payment.installment ?? asaasPayment.installment ?? undefined;

                    if ((!userId || !planId) && subscriptionAsaasId) {
                        const localSubRaw = await this.subscriptionRepository.getByAsaasId(
                            subscriptionAsaasId,
                        );
                        if (localSubRaw) {
                            const localSub = this.hydrateSubscription(localSubRaw);
                            userId = userId ?? localSub.userId;
                            planId = planId ?? (localSub.planId ?? undefined);
                            subId = subId ?? localSub.id;
                        }
                    }

                    if ((!userId || !planId) && installmentAsaasId) {
                        const localSubByInstallmentRaw =
                            await this.subscriptionRepository.getByInstallmentIdAsaas(
                                installmentAsaasId,
                            );

                        if (localSubByInstallmentRaw) {
                            const localSubByInstallment =
                                this.hydrateSubscription(localSubByInstallmentRaw);

                            userId = userId ?? localSubByInstallment.userId;
                            planId = planId ?? (localSubByInstallment.planId ?? undefined);
                            subId = subId ?? localSubByInstallment.id;
                        }
                    }

                    if (!body.payment.billingType && asaasPayment.billingType) {
                        body.payment.billingType = asaasPayment.billingType;
                    }
                } catch (fallbackError) {
                    console.error("[handlePaymentWebhook] Fallback ASAAS falhou:", fallbackError);
                }
            }

            const resolvedTimeZoneOffsetMinutesFinal = this.resolveTimeZoneOffsetMinutes(
                timeZoneOffsetMinutes,
                -180,
            );

            console.log(
                `[handlePaymentWebhook] userId resolvido: ${userId}, planId resolvido: ${planId}, couponId resolvido: ${couponId}, subId resolvido: ${subId}, cashbackUsedAmount resolvido: ${cashbackUsedAmount}, cashbackBaseAmount resolvido: ${cashbackBaseAmount}, minimumCharge resolvido: ${minimumCharge}, timeZoneOffsetMinutes resolvido: ${timeZoneOffsetMinutes} (final=${resolvedTimeZoneOffsetMinutesFinal})`,
            );

            if (userId) {
                const userExists = await this.userRepository.findById(userId);
                if (!userExists) {
                    console.error(
                        `[handlePaymentWebhook] Usuário ID ${userId} não encontrado. Pulando inserção de pagamento.`,
                    );
                    return { status: 200, message: `Usuário ID ${userId} não encontrado` };
                }
            } else {
                console.warn("[handlePaymentWebhook] userId é 0 ou nulo. Pulando inserção de pagamento.");
                return { status: 200, message: "Nenhum userId encontrado para associar o pagamento" };
            }

            // Só valida plano se existir (pagamento de plano).
            if (planId) {
                const planExists = await this.planRepository.findById(planId);
                if (!planExists) {
                    console.error(
                        `[handlePaymentWebhook] Plano ID ${planId} não encontrado. Pulando inserção.`,
                    );
                    return { status: 200, message: `Plano ID ${planId} não encontrado` };
                }
            }

            if (couponId) {
                const couponExists = await this.couponRepository.findById(couponId);
                if (!couponExists) {
                    console.error(
                        `[handlePaymentWebhook] Cupom ID ${couponId} não encontrado. Pulando inserção.`,
                    );
                    return { status: 200, message: `Cupom ID ${couponId} não encontrado` };
                }
            }

            // ✅ CORREÇÃO PRINCIPAL:
            // amount precisa refletir o valor final (após cupom + cashback),
            // calculado a partir do externalReference (cashbackBaseAmount - cashbackUsedAmount),
            // e com clamp mínimo (minimumCharge).
            const amount = this.resolveFinalAmountFromExternalReference({
                webhookValue,
                existingAmount: (existingPayment as any)?.amount,
                externalReference: parsedExternalReference
                    ? {
                        cashbackUsedAmount: parsedExternalReference.cashbackUsedAmount,
                        cashbackBaseAmount: parsedExternalReference.cashbackBaseAmount,
                        minimumCharge: parsedExternalReference.minimumCharge,
                    }
                    : null,
            });

            console.log(
                `[handlePaymentWebhook] ${
                    existingPayment ? "Atualizando" : "Registrando"
                } pagamento => userId: ${userId}, planId: ${planId}, couponId: ${couponId ?? null}, amount(FINAL): ${amount}, status: ${newStatus}`,
            );

            const paymentMethodIdFromBody = body.payment.billingType ?? undefined;
            const paymentMethodId: string =
                paymentMethodIdFromBody ?? existingPayment?.paymentMethodId ?? "UNKNOWN";

            const ensuredUserId = userId as number;
            const normalizedPlanId = planId ?? null;
            const normalizedCouponId = couponId ?? null;

            const cashbackUsedFromExisting = this.parseCashbackAmount(
                (existingPayment as any)?.cashbackUsedAmount,
            );
            const cashbackUsedFromExternalRef = this.parseCashbackAmount(cashbackUsedAmount);

            const cashbackUsedToPersist =
                cashbackUsedFromExisting > 0
                    ? cashbackUsedFromExisting
                    : cashbackUsedFromExternalRef > 0
                        ? cashbackUsedFromExternalRef
                        : 0;

            const dueAt =
                dueAtFromBody ?? (existingPayment as any)?.dueAt ?? paymentDate;

            const newPayment = new Payment({
                userId: ensuredUserId,
                planId: normalizedPlanId,
                couponId: normalizedCouponId,
                amount,
                status: newStatus,
                paymentDate,
                dueAt,
                paymentIdAsaas: paymentAsaasId,
                paymentMethodId,
                cashbackUsedAmount: cashbackUsedToPersist > 0 ? cashbackUsedToPersist : null,
            } as any);

            let savedPaymentId: number | undefined;

            if (existingPayment) {
                await this.paymentRepository.update({ id: existingPayment.id }, newPayment, true);
                savedPaymentId = existingPayment.id;
            } else {
                const created = await this.paymentRepository.create(newPayment as any);
                savedPaymentId = created?.id;
            }

            if (body.payment.subscription || subId) {
                let subscription: Subscription | null = null;

                if (body.payment.subscription) {
                    const subRaw = await this.subscriptionRepository.getByAsaasId(
                        body.payment.subscription,
                    );
                    subscription = subRaw ? this.hydrateSubscription(subRaw) : null;
                }

                if (subId && !subscription) {
                    const subRaw = await this.subscriptionRepository.findById(subId);
                    subscription = subRaw ? this.hydrateSubscription(subRaw) : null;
                }

                if (subscription) {
                    subId = subId ?? subscription.id;

                    await this.updateSubscriptionValidityFromPayment(
                        subscription,
                        paymentDate,
                        newStatus,
                    );
                }
            }

            if (body.payment.installment) {
                const subRaw = await this.subscriptionRepository.getByInstallmentIdAsaas(
                    body.payment.installment,
                );

                const subscription = subRaw ? this.hydrateSubscription(subRaw) : null;

                if (subscription) {
                    subId = subId ?? subscription.id;

                    await this.updateSubscriptionValidityFromPayment(
                        subscription,
                        paymentDate,
                        newStatus,
                    );
                }
            }

            const isPlanPayment = normalizedPlanId !== null;

            // -----------------------------------------------------------------
            // REFERRAL (Grupo/Posição)
            // -----------------------------------------------------------------
            if (newStatus === "PAID" && isPlanPayment) {
                if (subId !== undefined && subId !== null) {
                    try {
                        await this.referralBonusService.generateUniqueOnFirstPaidSubscription({
                            payerId: ensuredUserId,
                            subscriptionId: subId,
                            paymentId: savedPaymentId,
                        });
                    } catch (bonusError) {
                        console.warn(
                            "[handlePaymentWebhook] Bônus UNIQUE falhou (provável idempotência/duplicidade/sem grupo). Ignorando para não quebrar webhook.",
                            bonusError,
                        );
                    }
                }

                if (savedPaymentId !== undefined && savedPaymentId !== null) {
                    try {
                        await this.referralBonusService.generateRecurrentOnPaidPayment({
                            payerId: ensuredUserId,
                            paymentId: savedPaymentId,
                            paymentDate,
                            timeZoneOffsetMinutes: resolvedTimeZoneOffsetMinutesFinal,
                        });
                    } catch (bonusError) {
                        console.warn(
                            "[handlePaymentWebhook] Bônus RECURRENT falhou (provável idempotência/duplicidade/sem grupo). Ignorando para não quebrar webhook.",
                            bonusError,
                        );
                    }
                }
            }

            // -----------------------------------------------------------------
            // FASE 4: Débito de cashback (idempotente) quando PAID
            // -----------------------------------------------------------------
            if (newStatus === "PAID" && cashbackUsedToPersist > 0) {
                try {
                    await this.debitCashbackIdempotentOnPaid({
                        userId: ensuredUserId,
                        amount: cashbackUsedToPersist,
                        paymentIdAsaas: paymentAsaasId,
                        paymentIdLocal: savedPaymentId ?? null,
                        meta: {
                            planId: normalizedPlanId,
                            couponId: normalizedCouponId,
                            isPlanPayment,
                            cashbackBaseAmount: this.normalizeMoney(cashbackBaseAmount),
                            minimumCharge: this.normalizeMoney(minimumCharge),
                            timeZoneOffsetMinutes: resolvedTimeZoneOffsetMinutesFinal,
                        },
                    });
                } catch (cashbackError) {
                    console.error(
                        "[handlePaymentWebhook] ERRO ao debitar cashback em pagamento PAID. Operação idempotente, mas falhou por saldo/concorrência/expiração.",
                        cashbackError,
                    );
                }
            }

            console.log(`[handlePaymentWebhook] Pagamento armazenado com sucesso: ${paymentAsaasId}`);

            return { status: 200, message: "Pagamento processado com sucesso", newStatus };
        } catch (error) {
            console.error("[handlePaymentWebhook] Erro inesperado:", error);
            return { status: 200, message: "Erro interno", error };
        }
    }

    // ---------------------------------------------------------------------
    // Helpers de plano / assinatura
    // ---------------------------------------------------------------------

    private calculatePlanExpiration(plan: Plan, referenceDate: Date): Date {
        const baseDate = new Date(referenceDate.getTime());

        if (
            plan.duration !== undefined &&
            plan.duration !== null &&
            plan.duration > 0
        ) {
            baseDate.setDate(baseDate.getDate() + plan.duration);
        } else {
            switch (plan.periodicityType) {
                case PeriodicityType.WEEK:
                    baseDate.setDate(baseDate.getDate() + 7);
                    break;
                case PeriodicityType.MONTH:
                    baseDate.setDate(baseDate.getDate() + 30);
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

        if (
            plan.extraMonths !== undefined &&
            plan.extraMonths !== null &&
            plan.extraMonths > 0
        ) {
            baseDate.setMonth(baseDate.getMonth() + plan.extraMonths);
        }

        return baseDate;
    }

    private async updateSubscriptionValidityFromPayment(
        subscriptionInput: Subscription,
        paymentDate: Date,
        newStatus: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void> {
        const subscription = this.hydrateSubscription(subscriptionInput);

        if (newStatus === "CANCELED") {
            subscription.isActive = false;
            subscription.subscriptionStatus = "CANCELED";
            subscription.endDate = paymentDate;

            await this.subscriptionRepository.update(subscription.id, subscription);

            console.log(
                `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} marcada como CANCELED e isActive = false (cancelamento explícito).`,
            );
            return;
        }

        if (newStatus !== "PAID") {
            return;
        }

        if (subscription.isCanceled()) {
            subscription.isActive = false;
            await this.subscriptionRepository.update(subscription.id, subscription);
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

        if (subscription.planType !== plan.periodicityType) {
            subscription.planType = plan.periodicityType;
        }

        const hasFutureExpiration =
            subscription.expiresAt !== undefined &&
            subscription.expiresAt !== null &&
            subscription.expiresAt.getTime() > paymentDate.getTime();

        const referenceBase = hasFutureExpiration
            ? (subscription.expiresAt as Date)
            : paymentDate;

        const expiresAt = this.calculatePlanExpiration(plan, referenceBase);
        const now = new Date();
        const isActive = expiresAt.getTime() >= now.getTime();

        if (!subscription.startDate) {
            subscription.startDate = paymentDate;
        }

        subscription.expiresAt = expiresAt;
        subscription.isActive = isActive;

        const expired = subscription.isExpired(now);

        if (subscription.isCanceled()) {
            subscription.isActive = false;
        } else {
            subscription.subscriptionStatus = !expired ? "ACTIVE" : "SUSPENDED";
            if (expired) {
                subscription.endDate = expiresAt;
            }
        }

        await this.subscriptionRepository.update(subscription.id, subscription);

        console.log(
            `[updateSubscriptionValidityFromPayment] Assinatura ${subscription.id} atualizada => isActive: ${subscription.isActive}, subscriptionStatus: ${subscription.subscriptionStatus}, startDate: ${subscription.startDate.toISOString()}, expiresAt: ${subscription.expiresAt?.toISOString()}`,
        );
    }

    // ---------------------------------------------------------------------
    // Relatórios / estatísticas
    // ---------------------------------------------------------------------

    public async getMonthlyRevenueHistory() {
        return this.paymentRepository.getMonthlyRevenueHistory();
    }

    public async getYearlyRevenueHistory() {
        return this.paymentRepository.getYearlyRevenueHistory();
    }

    public async updatePaymentStatus(
        paymentId: number,
        status: "PAID" | "PENDING" | "CANCELED",
    ): Promise<void> {
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

    private async syncPaymentWithAsaasByLocalId(paymentId: number): Promise<void> {
        const localPayment = await this.paymentRepository.getOneByFilter({
            id: paymentId,
        });

        if (!localPayment) {
            console.warn(
                `[syncPaymentWithAsaasByLocalId] Pagamento local ${paymentId} não encontrado.`,
            );
            return;
        }

        if (!localPayment.paymentIdAsaas) {
            console.warn(
                `[syncPaymentWithAsaasByLocalId] Pagamento ${paymentId} sem paymentIdAsaas. Nada para sincronizar via consulta direta ao ASAAS.`,
            );
            return;
        }

        if (localPayment.status === "PAID" || localPayment.status === "CANCELED") {
            return;
        }

        try {
            const asaasPaymentRaw = await asaasGetPayment(localPayment.paymentIdAsaas);

            type AsaasPaymentLike = {
                id: string;
                status: ASAASPaymentStatusEnum | string;
                subscription?: string | null;
                installment?: string | null;
                externalReference?: string | null;
                paymentDate?: string | null;
                dueDate?: string | null;
            };

            const asaasPayment = asaasPaymentRaw as AsaasPaymentLike;

            const internalStatusFromAsaas = this.mapAsaasPaymentStatusToInternal(
                asaasPayment.status as ASAASPaymentStatusEnum,
            );

            if (internalStatusFromAsaas !== localPayment.status) {
                console.log(
                    `[syncPaymentWithAsaasByLocalId] Atualizando status do pagamento ${paymentId} de ${localPayment.status} para ${internalStatusFromAsaas} com base no ASAAS.`,
                );

                await this.paymentRepository.updatePaymentStatus(
                    localPayment.id,
                    internalStatusFromAsaas,
                );

                if (
                    internalStatusFromAsaas === "PAID" ||
                    internalStatusFromAsaas === "CANCELED"
                ) {
                    let subscription: Subscription | null = null;

                    if (asaasPayment.subscription) {
                        const subRaw = await this.subscriptionRepository.getByAsaasId(
                            asaasPayment.subscription,
                        );
                        subscription = subRaw ? this.hydrateSubscription(subRaw) : null;
                    }

                    if (!subscription && asaasPayment.installment) {
                        const subRaw =
                            await this.subscriptionRepository.getByInstallmentIdAsaas(
                                asaasPayment.installment,
                            );
                        subscription = subRaw ? this.hydrateSubscription(subRaw) : null;
                    }

                    if (!subscription && asaasPayment.externalReference) {
                        const parsed = this.parseAsaasExternalReference(asaasPayment.externalReference);
                        if (parsed?.subId !== undefined && parsed?.subId !== null) {
                            const subRaw = await this.subscriptionRepository.findById(parsed.subId);
                            subscription = subRaw ? this.hydrateSubscription(subRaw) : null;
                        }
                    }

                    if (subscription) {
                        const paymentDate =
                            asaasPayment.paymentDate !== undefined &&
                            asaasPayment.paymentDate !== null
                                ? new Date(asaasPayment.paymentDate)
                                : new Date();

                        await this.updateSubscriptionValidityFromPayment(
                            subscription,
                            paymentDate,
                            internalStatusFromAsaas,
                        );
                    } else {
                        console.log(
                            `[syncPaymentWithAsaasByLocalId] Nenhuma assinatura local encontrada para o pagamento Asaas ${localPayment.paymentIdAsaas}.`,
                        );
                    }
                }
            }
        } catch (error) {
            console.error(
                "[syncPaymentWithAsaasByLocalId] Erro ao consultar pagamento no ASAAS:",
                error,
            );
        }
    }

    public async getPaymentDetailsById(paymentId: number) {
        await this.syncPaymentWithAsaasByLocalId(paymentId);
        return this.paymentRepository.getPaymentDetailsById(paymentId);
    }

    public async getMRR() {
        return this.paymentRepository.getMRR();
    }

    private resolveFinalAmountFromExternalReference(params: {
        webhookValue: unknown;
        existingAmount: unknown;
        externalReference?: {
            cashbackUsedAmount?: unknown;
            cashbackBaseAmount?: unknown;
            minimumCharge?: unknown;
        } | null;
    }): number {
        const ext = params.externalReference ?? null;

        const minCharge = this.ensureMinimumAmount(
            Number(ext?.minimumCharge ?? PaymentService.MINIMUM_CHARGE_AMOUNT),
            PaymentService.MINIMUM_CHARGE_AMOUNT,
        );

        const baseAfterCoupon = this.normalizeMoney(ext?.cashbackBaseAmount);
        const cashbackUsed = this.parseCashbackAmount(ext?.cashbackUsedAmount);

        // ✅ Fonte de verdade: externalReference (cashbackBaseAmount - cashbackUsedAmount)
        if (baseAfterCoupon > 0) {
            const computed = baseAfterCoupon - cashbackUsed;
            return this.ensureMinimumAmount(computed, minCharge);
        }

        // ✅ Fallback seguro: se já existe pagamento local com amount válido, não sobrescreve com "value" do webhook
        const existing = this.normalizeMoney(params.existingAmount);
        if (existing > 0) {
            return this.ensureMinimumAmount(existing, minCharge);
        }

        // ✅ Último fallback: usa o valor do webhook
        const webhookValue = this.normalizeMoney(params.webhookValue);
        return this.ensureMinimumAmount(webhookValue, minCharge);
    }
}
