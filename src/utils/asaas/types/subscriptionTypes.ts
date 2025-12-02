// src/utils/asaas/types/subscriptionTypes.ts

import {
    ASAASPaymentBillingTypeEnum,
    ASAASPaymentStatusEnum,
} from "./paymentTypes";

export enum ASAASSubscriptionCycleEnum {
    WEEKLY = "WEEKLY",
    BIWEEKLY = "BIWEEKLY",
    MONTHLY = "MONTHLY",
    QUARTERLY = "QUARTERLY",
    SEMIANNUALLY = "SEMIANNUALLY",
    YEARLY = "YEARLY",
}

export enum ASAASSubscriptionBillingTypeEnum {
    BOLETO = "BOLETO",
    CREDIT_CARD = "CREDIT_CARD",
    PIX = "PIX",
}

export enum ASAASSubscriptionStatusEnum {
    ACTIVE = "ACTIVE",
    EXPIRED = "EXPIRED",
    CANCELLED = "CANCELLED",
    OVERDUE = "OVERDUE",
    INACTIVE = "INACTIVE",
}

export interface ASAASCreditCardHolderInfo {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string;
    phone: string;
    mobilePhone?: string;
}

export interface ASAASCreditCard {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
}

export interface ASAASCreateSubscriptionDTO {
    customer: string;
    billingType: ASAASSubscriptionBillingTypeEnum;
    nextDueDate: string;
    value: number;
    cycle: ASAASSubscriptionCycleEnum;
    description?: string;
    discount?: {
        value: number;
        dueDateLimitDays?: number;
        type: "FIXED" | "PERCENTAGE";
    };
    fine?: {
        value: number;
        type: "FIXED" | "PERCENTAGE";
    };
    interest?: {
        value: number;
    };
    creditCard?: ASAASCreditCard;
    creditCardHolderInfo?: ASAASCreditCardHolderInfo;
    externalReference?: string;
    postalService?: boolean;
    /**
     * Primeiro lançamento manual associado à assinatura.
     * Usado quando a criação da assinatura já inclui uma cobrança inicial.
     */
    charge?: {
        value: number;
        dueDate: string;
        billingType: ASAASSubscriptionBillingTypeEnum;
    };
}

export interface ASAASSubscriptionResponse {
    id: string;
    dateCreated: string;
    customer: string;
    paymentLink?: string | null;
    billingType: ASAASSubscriptionBillingTypeEnum;
    value: number;
    nextDueDate: string;
    cycle: ASAASSubscriptionCycleEnum;
    description: string | null;
    status: ASAASSubscriptionStatusEnum;
    discount?:
        | {
        value: number;
        dueDateLimitDays: number;
        type: "FIXED" | "PERCENTAGE";
    }
        | null;
    fine?:
        | {
        value: number;
        type: "FIXED" | "PERCENTAGE";
    }
        | null;
    interest?:
        | {
        value: number;
    }
        | null;
    deleted: boolean;
    externalReference?: string | null;
}

export interface ASAASUpdateSubscriptionDTO {
    billingType?: ASAASSubscriptionBillingTypeEnum;
    value?: number;
    nextDueDate?: string;
    description?: string;
    status?: ASAASSubscriptionStatusEnum;
    cycle?: ASAASSubscriptionCycleEnum;
    discount?: {
        value: number;
        dueDateLimitDays?: number;
        type: "FIXED" | "PERCENTAGE";
    };
    fine?: {
        value: number;
        type: "FIXED" | "PERCENTAGE";
    };
    interest?: {
        value: number;
    };
    creditCard?: ASAASCreditCard;
    creditCardHolderInfo?: ASAASCreditCardHolderInfo;
    externalReference?: string;
    postalService?: boolean;
}

export interface ASAASErrorResponse {
    errors: Array<{
        code: string;
        description: string;
    }>;
}

/**
 * Pagamento gerado a partir de uma assinatura ASAAS.
 */
export interface ASAASSubscriptionPayment {
    object: string;
    id: string;
    dateCreated: string;
    customer: string;
    subscription: string;
    checkoutSession: string | null;
    paymentLink: string | null;
    value: number;
    netValue: number;
    originalValue: number | null;
    interestValue: number | null;
    description: string | null;
    billingType: ASAASPaymentBillingTypeEnum | string;
    pixTransaction: string | null;
    status: ASAASPaymentStatusEnum | string;
    dueDate: string;
    originalDueDate: string;
    paymentDate: string | null;
    clientPaymentDate: string | null;
    installmentNumber: number | null;
    invoiceUrl: string;
    invoiceNumber: string;
    externalReference: string | null;
    deleted: boolean;
    anticipated: boolean;
    anticipable: boolean;
    creditDate: string | null;
    estimatedCreditDate: string | null;
    transactionReceiptUrl: string | null;
    nossoNumero: string | null;
    bankSlipUrl: string | null;
    lastInvoiceViewedDate: string | null;
    lastBankSlipViewedDate: string | null;
    discount: {
        value: number;
        limitDate: string | null;
        dueDateLimitDays: number;
        type: string;
    };
    fine: {
        value: number;
        type: string;
    };
    interest: {
        value: number;
        type: string;
    };
    postalService: boolean;
    custody: unknown | null;
    escrow: unknown | null;
    refunds: unknown | null;
}

/**
 * Lista de cobranças geradas a partir de uma assinatura.
 * Usada, por exemplo, para recuperar o primeiro pagamento (pay_...)
 * logo após criar a assinatura ASAAS.
 */
export interface ASAASSubscriptionPaymentListResponse {
    object: string;
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
    data: ASAASSubscriptionPayment[];
}
