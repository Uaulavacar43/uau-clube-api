// src/modules/payment/PaymentController.ts
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { CreatePaymentDTO } from "./dto/CreatePaymentDTO";
import type { CreateSubscriptionToPlanDTO } from "./dto/CreateSubscriptionToPlanDTO";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";
import { UpdatePaymentStatusSchema } from "./dto/UpdatePaymentStatusDTO";
import type { PaymentService } from "./PaymentService";

export class PaymentController {
	constructor(private paymentService: PaymentService) {}

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

			const payment = await this.paymentService.subscribeToPlan(data, user.id);

			res.status(201).customJson(payment);
		} catch (error) {
			next(error);
		}
	}

	public async getYearlyRevenueHistory(
		req: Request,
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
		req: Request,
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
		req: Request,
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
		req: Request,
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
			if (isNaN(paymentId)) {
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
		req: Request,
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

	// WEBHOOK
	public async paymentWebhook(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const asaasAccessToken = req.headers["asaas-access-token"];
			if (asaasAccessToken !== process.env.ASAAS_ACCESS_TOKEN) {
				throw new AppError("Invalid Asaas Access Token", 400);
			}

			const webhookBody = req.body;

			console.log("Webhook received:", webhookBody);

			const result = await this.paymentService.paymentWebhook(webhookBody);

			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}
}
