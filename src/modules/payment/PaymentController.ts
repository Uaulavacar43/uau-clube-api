// src/modules/payment/PaymentController.ts
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";
import { UpdatePaymentStatusSchema } from "./dto/UpdatePaymentStatusDTO";
import type { PaymentService } from "./PaymentService";

export class PaymentController {
    constructor(private readonly paymentService: PaymentService) {}

    public async createPayment(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        const data = res.locals as CreatePaymentDTO;

        try {
            const loggedUser = req.user;
            if (!loggedUser) {
                throw new AppError("Você não tem permissão para isto", 403);
            }

            const payment = await this.paymentService.createPayment(
                data,
                loggedUser.id,
            );
            res.status(201).customJson(payment);
        } catch (error) {
            next(error);
        }
    }

    public async subscribeToPlan(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        const data = res.locals as CreateSubscriptionToPlanDTO;

        try {
            const user = req.user;
            if (!user) {
                throw new AppError("Você não tem permissão para isto", 403);
            }

            const payment = await this.paymentService.subscribeToPlan(
                data,
                user.id,
            );

            res.status(201).customJson(payment);
        } catch (error) {
            next(error);
        }
    }

    public async getMonthlyRevenueHistory(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const history =
                await this.paymentService.getMonthlyRevenueHistory();
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
            const history = await this.paymentService.getYearlyRevenueHistory();
            res.status(200).customJson(history);
        } catch (error) {
            next(error);
        }
    }

    public async updatePaymentStatus(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = UpdatePaymentStatusSchema.parse(req.body);
            await this.paymentService.updatePaymentStatus(data.id, data.status);
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

    public async getTotalRevenue(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const totalRevenue = await this.paymentService.getTotalRevenue();
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
                await this.paymentService.getCurrentMonthRevenue();
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
                await this.paymentService.getNextMonthPredictedRevenue();
            res.status(200).customJson({ nextMonthPredictedRevenue });
        } catch (error) {
            next(error);
        }
    }

    public async getAllPaymentsWithDetails(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = res.locals as GetAllPaymentsWithDetailsDTO;

            const payments =
                await this.paymentService.getAllPaymentsWithDetails(data);

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
            const paymentId = Number(req.params.id);
            if (Number.isNaN(paymentId)) {
                throw new AppError("Invalid payment ID", 400);
            }

            const paymentDetails =
                await this.paymentService.getPaymentDetailsById(paymentId);
            if (!paymentDetails) {
                throw new AppError("Payment not found", 404);
            }

            res.status(200).customJson(paymentDetails);
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
            const mrr = await this.paymentService.getMRR();
            res.status(200).customJson({ mrr });
        } catch (error) {
            next(error);
        }
    }

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

            const result =
                await this.paymentService.paymentWebhook(webhookBody);

            res.status(200).customJson(result);
        } catch (error) {
            next(error);
        }
    }
}
