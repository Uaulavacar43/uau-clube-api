import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { UpdateSubscriptionDTO } from "./dto/UpdateSubscriptionDTO";
import type { SubscriptionService } from "./SubscriptionService";

export class SubscriptionController {
	constructor(private subscriptionService: SubscriptionService) {}

	// public async registerSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
	// 	try {
	// 		const data = res.locals as RegisterSubscriptionDTO;
	// 		const subscription = await this.subscriptionService.registerSubscription(data);
	// 		res.status(201).customJson(subscription);
	// 	} catch (error) {
	// 		next(error);
	// 	}
	// }

	public async cancelSubscription(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const subscriptionId = Number(req.params.id);

			if (isNaN(subscriptionId)) {
				throw new AppError("ID de assinatura inválido", 400);
			}

			await this.subscriptionService.cancelSubscription(subscriptionId);
			res
				.status(200)
				.customJson({ message: "Assinatura cancelada com sucesso" });
		} catch (error) {
			next(error);
		}
	}

	public async listSubscriptions(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (!req.user) {
				throw new AppError("Não autorizado", 401);
			}

			const subscriptions = await this.subscriptionService.listSubscriptions(
				req.user.id,
			);
			res.status(200).customJson(subscriptions);
		} catch (error) {
			next(error);
		}
	}

	public async updateSubscription(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as UpdateSubscriptionDTO;

			if (req.user?.role !== "ADMIN") {
				throw new AppError("Não autorizado", 401);
			}

			const updatedSubscription =
				await this.subscriptionService.updateSubscription(data.id, data);
			res.status(200).customJson(updatedSubscription);
		} catch (error) {
			next(error);
		}
	}
}
