// src/entities/Payment.ts

export class Payment {
    constructor(data: {
        id?: number;
        userId: number;
        planId?: number | null;
        amount: number;
        paymentDate?: Date;
        status: "PAID" | "PENDING" | "CANCELED";
        installments?: number | null;
        pixQrCode?: string | null;
        pixPayload?: string | null;
        createdAt?: Date;
        updatedAt?: Date;
        paymentMethodId?: string | null;
        paymentIdAsaas?: string | null; // ID remoto no ASAAS (pay_..., às vezes null)
        couponId?: number | null;
    }) {
        this.id = data.id ?? 0;
        this.userId = data.userId;
        this.planId = data.planId ?? null;
        this.amount = data.amount;
        this.paymentDate = data.paymentDate ?? new Date();
        this.status = data.status;
        this.installments = data.installments ?? null;
        this.pixQrCode = data.pixQrCode ?? null;
        this.pixPayload = data.pixPayload ?? null;
        this.createdAt = data.createdAt ?? new Date();
        this.updatedAt = data.updatedAt ?? new Date();
        this.paymentMethodId = data.paymentMethodId ?? null;

        // Sempre presente no modelo (string ou null), para alinhar com LocalPaymentForSync
        this.paymentIdAsaas = data.paymentIdAsaas ?? null;

        this.couponId = data.couponId ?? null;
    }

    id: number;
    userId: number;
    planId: number | null;
    amount: number;
    paymentDate: Date;
    status: "PAID" | "PENDING" | "CANCELED";
    installments: number | null;
    pixQrCode: string | null;
    pixPayload: string | null;
    createdAt: Date;
    updatedAt: Date;
    paymentMethodId: string | null;

    // Importante para o sync com o ASAAS e para o método syncPaymentWithAsaasByLocalId
    paymentIdAsaas: string | null;

    couponId: number | null;
}
