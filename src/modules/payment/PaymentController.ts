// src/modules/payment/PaymentController.ts
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";

import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";
import { UpdatePaymentStatusSchema } from "./dto/UpdatePaymentStatusDTO";
import {PaymentCreateService} from "./PaymentCreateService";
import {SubscriptionCreateService} from "./SubscriptionCreateService";
import {PaymentQueryService} from "./PaymentQueryService";
import {PaymentMetricsService} from "./PaymentMetricsService";
import {PaymentWebhookService} from "./PaymentWebhookService";



/**
 * Sugestão de organização (camada de "use-cases"):
 * - PaymentQueryService: leituras/listagens/detalhes + update status manual
 * - PaymentMetricsService: métricas e históricos (MRR, revenue etc.)
 * - PaymentWebhookService: processamento do webhook ASAAS
 *
 * Se teus arquivos tiverem outros nomes, só troca os imports/types mantendo as assinaturas.
 */

type LoggedUser = { id: number };

export class PaymentController {
    constructor(
        private readonly paymentCreateService: PaymentCreateService,
        private readonly subscriptionCreateService: SubscriptionCreateService,
        private readonly paymentQueryService: PaymentQueryService,
        private readonly paymentMetricsService: PaymentMetricsService,
        private readonly paymentWebhookService: PaymentWebhookService,
    ) {}

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private getLoggedUserOrThrow(req: Request): LoggedUser {
        const user = (req as Request & { user?: unknown }).user;

        if (!user || typeof user !== "object") {
            throw new AppError("Você não tem permissão para isto", 403);
        }

        const id = (user as { id?: unknown }).id;
        if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) {
            throw new AppError("Você não tem permissão para isto", 403);
        }

        return { id };
    }

    private parseIdOrThrow(raw: unknown, label: string): number {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
            throw new AppError(`Invalid ${label}`, 400);
        }
        return n;
    }

    // ---------------------------------------------------------------------
    // Create payment (avulso / washServices)
    // ---------------------------------------------------------------------

    public async createPayment(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = res.locals as CreatePaymentDTO;
            const loggedUser = this.getLoggedUserOrThrow(req);

            const payment = await this.paymentCreateService.createPayment(
                data,
                loggedUser.id,
            );

            res.status(201).customJson(payment);
        } catch (error) {
            next(error);
        }
    }

    // ---------------------------------------------------------------------
    // Subscribe plan (assinatura)
    // ---------------------------------------------------------------------

    public async subscribeToPlan(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = res.locals as CreateSubscriptionToPlanDTO;
            const loggedUser = this.getLoggedUserOrThrow(req);

            const result = await this.subscriptionCreateService.subscribeToPlan(
                data,
                loggedUser.id,
            );

            res.status(201).customJson(result);
        } catch (error) {
            next(error);
        }
    }

    // ---------------------------------------------------------------------
    // Metrics / revenue
    // ---------------------------------------------------------------------

    public async getMonthlyRevenueHistory(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const history =
                await this.paymentMetricsService.getMonthlyRevenueHistory();
            res.status(200).customJson(history);
        } catch (error) {
            next(error);
        }
    }

    public async getYearlyRevenueHistory(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const history =
                await this.paymentMetricsService.getYearlyRevenueHistory();
            res.status(200).customJson(history);
        } catch (error) {
            next(error);
        }
    }

    public async getTotalRevenue(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const totalRevenue = await this.paymentMetricsService.getTotalRevenue();
            res.status(200).customJson({ totalRevenue });
        } catch (error) {
            next(error);
        }
    }

    public async getCurrentMonthRevenue(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const currentMonthRevenue =
                await this.paymentMetricsService.getCurrentMonthRevenue();
            res.status(200).customJson({ currentMonthRevenue });
        } catch (error) {
            next(error);
        }
    }

    public async getNextMonthPredictedRevenue(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const nextMonthPredictedRevenue =
                await this.paymentMetricsService.getNextMonthPredictedRevenue();
            res.status(200).customJson({ nextMonthPredictedRevenue });
        } catch (error) {
            next(error);
        }
    }

    public async getMRR(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const mrr = await this.paymentMetricsService.getMRR();
            res.status(200).customJson({ mrr });
        } catch (error) {
            next(error);
        }
    }

    // ---------------------------------------------------------------------
    // Queries / details
    // ---------------------------------------------------------------------

    public async getAllPaymentsWithDetails(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = res.locals as GetAllPaymentsWithDetailsDTO;

            const payments =
                await this.paymentQueryService.getAllPaymentsWithDetails(data);

            res.status(200).customJson(payments);
        } catch (error) {
            next(error);
        }
    }

    public async getPaymentDetailsById(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const paymentId = this.parseIdOrThrow(req.params.id, "payment ID");

            const paymentDetails =
                await this.paymentQueryService.getPaymentDetailsById(paymentId);

            if (!paymentDetails) {
                throw new AppError("Payment not found", 404);
            }

            res.status(200).customJson(paymentDetails);
        } catch (error) {
            next(error);
        }
    }

    // ---------------------------------------------------------------------
    // Manual status update (admin, etc.)
    // ---------------------------------------------------------------------

    public async updatePaymentStatus(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = UpdatePaymentStatusSchema.parse(req.body);

            await this.paymentQueryService.updatePaymentStatus(
                data.id,
                data.status,
            );

            res
                .status(200)
                .customJson({ message: "Payment status updated successfully" });
        } catch (error) {
            if (error instanceof Error) {
                next(new AppError(error.message, 400));
            } else {
                next(error);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Webhook ASAAS
    // ---------------------------------------------------------------------

    public async paymentWebhook(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const asaasAccessTokenHeaderRaw = req.headers["asaas-access-token"];
            const asaasAccessTokenHeader =
                Array.isArray(asaasAccessTokenHeaderRaw)
                    ? asaasAccessTokenHeaderRaw[0]
                    : asaasAccessTokenHeaderRaw;

            const expectedToken = process.env.ASAAS_ACCESS_TOKEN;

            if (
                typeof expectedToken === "string" &&
                expectedToken.length > 0 &&
                asaasAccessTokenHeader !== expectedToken
            ) {
                console.warn(
                    "[PaymentController.paymentWebhook] Token ASAAS inválido. Header presente:",
                    typeof asaasAccessTokenHeader === "string",
                );
                throw new AppError("Invalid Asaas Access Token", 400);
            }

            console.log(
                "[PaymentController.paymentWebhook] Webhook recebido. Header presente:",
                typeof asaasAccessTokenHeader === "string",
                "Env configurada:",
                typeof expectedToken === "string" && expectedToken.length > 0,
            );

            const webhookBody = req.body;

            console.log(
                "[PaymentController.paymentWebhook] Body recebido do ASAAS:",
                JSON.stringify(webhookBody, null, 2),
            );

            const result = await this.paymentWebhookService.handleWebhook(
                webhookBody,
            );

            res.status(200).customJson(result);
        } catch (error) {
            next(error);
        }
    }
}
