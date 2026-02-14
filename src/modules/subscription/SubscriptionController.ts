import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { ActivateSubscriptionDTO } from "./dto/ActivateSubscriptionDTO";
import type { CreateSubscriptionDTO } from "./dto/CreateSubscriptionDTO";
import type { UpdateSubscriptionDTO } from "./dto/UpdateSubscriptionDTO";
import type { SubscriptionService } from "./SubscriptionService";

export class SubscriptionController {
	constructor(private subscriptionService: SubscriptionService) { }

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

	public async listSubscriptionsByUser(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (!req.user) {
				throw new AppError("Não autorizado", 401);
			}
			console.log(req);
			const userId = Number(req.query.userId) || req.user.id;

			const subscriptions = await this.subscriptionService.listSubscriptionsByUserID(
				userId,
			);
			res.status(200).customJson(subscriptions);
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
			const subscriptions = await this.subscriptionService.listSubscriptions();
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

	public async activateSubscription(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (req.user?.role !== "ADMIN") {
				throw new AppError("Não autorizado. Apenas administradores podem ativar assinaturas.", 401);
			}

			const subscriptionId = Number(req.params.id);

			if (isNaN(subscriptionId)) {
				throw new AppError("ID de assinatura inválido", 400);
			}

			const data: ActivateSubscriptionDTO = {
				id: subscriptionId,
				planId: req.body.planId,
				startDate: req.body.startDate,
				endDate: req.body.endDate,
			};

			const activatedSubscription =
				await this.subscriptionService.activateSubscription(subscriptionId, data);
			res.status(200).customJson({
				message: "Assinatura ativada com sucesso",
				subscription: activatedSubscription,
			});
		} catch (error) {
			next(error);
		}
	}

	public async createSubscription(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (req.user?.role !== "ADMIN") {
				throw new AppError("Não autorizado. Apenas administradores podem criar assinaturas.", 401);
			}

			const data: CreateSubscriptionDTO = {
				userId: req.body.userId,
				planId: req.body.planId,
				carId: req.body.carId,
				startDate: req.body.startDate,
				endDate: req.body.endDate,
			};

			if (!data.userId || !data.planId) {
				throw new AppError("userId e planId são obrigatórios", 400);
			}

			const newSubscription =
				await this.subscriptionService.createSubscription(data);
			res.status(201).customJson({
				message: "Assinatura criada com sucesso",
				subscription: newSubscription,
			});
		} catch (error) {
			next(error);
		}
	}
}
