// src/modules/payment/PaymentWebhookService.ts
import prisma from "../../config/dbConfig";
import { AppError } from "../../error/AppError";

import { AsaasBillingService } from "./AsaasBillingService";
import { ASAASPaymentStatusEnum } from "../../utils/asaas/types/paymentTypes";

type WebhookHandleResult = {
    ok: boolean;
    message: string;
    paymentIdAsaas?: string;
    internalPaymentId?: number;
    previousStatus?: string;
    newStatus?: string;
};

type UpdateStatusInput = {
    id: number;
    status: "PAID" | "PENDING" | "CANCELED";
};

export class PaymentWebhookService {
    constructor(private readonly asaasBillingService: AsaasBillingService) {}

    private extractAsaasPaymentId(body: unknown): string | null {
        if (typeof body !== "object" || body === null) return null;

        // formatos comuns:
        // body.payment.id
        // body.paymentId
        // body.id (às vezes)
        const b = body as Record<string, unknown>;

        if (typeof b.paymentId === "string" && b.paymentId.trim().length > 0) {
            return b.paymentId.trim();
        }

        if (typeof b.id === "string" && b.id.trim().length > 0) {
            return b.id.trim();
        }

        const payment = b.payment;
        if (typeof payment === "object" && payment !== null) {
            const p = payment as Record<string, unknown>;
            if (typeof p.id === "string" && p.id.trim().length > 0) return p.id.trim();
        }

        return null;
    }

    private extractAsaasStatus(body: unknown): string | null {
        if (typeof body !== "object" || body === null) return null;

        const b = body as Record<string, unknown>;
        const payment = b.payment;

        if (typeof payment === "object" && payment !== null) {
            const p = payment as Record<string, unknown>;
            if (typeof p.status === "string" && p.status.trim().length > 0) {
                return p.status.trim();
            }
        }

        if (typeof b.status === "string" && b.status.trim().length > 0) {
            return b.status.trim();
        }

        return null;
    }

    public async handleWebhook(params: {
        asaasAccessTokenHeader: string | undefined;
        expectedToken: string | undefined;
        webhookBody: unknown;
    }): Promise<WebhookHandleResult> {
        const { asaasAccessTokenHeader, expectedToken, webhookBody } = params;

        if (typeof expectedToken === "string" && expectedToken.length > 0) {
            if (asaasAccessTokenHeader !== expectedToken) {
                throw new AppError("Invalid Asaas Access Token", 400);
            }
        }

        const asaasPaymentId = this.extractAsaasPaymentId(webhookBody);
        if (!asaasPaymentId) {
            return {
                ok: true,
                message: "Webhook recebido, mas não foi possível extrair paymentId do ASAAS.",
            };
        }

        const asaasStatusRaw = this.extractAsaasStatus(webhookBody);
        if (!asaasStatusRaw) {
            return {
                ok: true,
                message: "Webhook recebido, mas não foi possível extrair status do ASAAS.",
                paymentIdAsaas: asaasPaymentId,
            };
        }

        const payment = await prisma.payment.findFirst({
            where: { paymentIdAsaas: asaasPaymentId },
        });

        if (!payment) {
            return {
                ok: true,
                message: "Pagamento local não encontrado para este paymentIdAsaas (ignorado).",
                paymentIdAsaas: asaasPaymentId,
            };
        }

        const newInternalStatus =
            this.asaasBillingService.mapAsaasPaymentStatusToInternal(
                asaasStatusRaw as ASAASPaymentStatusEnum,
            );

        if (payment.status === newInternalStatus) {
            return {
                ok: true,
                message: "Webhook idempotente: status já estava atualizado.",
                paymentIdAsaas: asaasPaymentId,
                internalPaymentId: payment.id,
                previousStatus: payment.status,
                newStatus: newInternalStatus,
            };
        }

        const updated = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: newInternalStatus,
                updatedAt: new Date(),
            },
        });

        /**
         * Se tu tiver regras extras no teu sistema:
         * - idempotência por tabela de webhook log
         * - confirmação de cashback / carteira interna
         * - ativação/cancelamento de assinatura
         *
         * A melhor decisão aqui é NÃO inventar método inexistente.
         * Então este service fica responsável por:
         * - validar token
         * - localizar payment local
         * - mapear status e atualizar
         * E o resto (cashback/subscription) fica no teu lifecycle/cashback quando tu encaixar.
         */

        return {
            ok: true,
            message: "Status atualizado via webhook.",
            paymentIdAsaas: asaasPaymentId,
            internalPaymentId: updated.id,
            previousStatus: payment.status,
            newStatus: updated.status,
        };
    }

    public async updatePaymentStatus(input: UpdateStatusInput): Promise<void> {
        const { id, status } = input;

        const payment = await prisma.payment.findUnique({ where: { id } });
        if (!payment) {
            throw new AppError("Payment not found", 404);
        }

        await prisma.payment.update({
            where: { id },
            data: { status, updatedAt: new Date() },
        });
    }
}
