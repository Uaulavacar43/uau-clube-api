// src/modules/subscription/SubscriptionController.ts

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { UpdateSubscriptionDTO } from "./dto/UpdateSubscriptionDTO";
import type { SubscriptionService } from "./SubscriptionService";

type SubscriptionLike = {
	id: number;
	subscriptionStatus?: "ACTIVE" | "SUSPENDED" | "CANCELED" | string;
	expiresAt?: Date | string | null;
};

function computeIsCurrentlyActive(
	sub: SubscriptionLike,
	referenceDate: Date = new Date(),
): boolean {
	if (sub.subscriptionStatus !== "ACTIVE") return false;
	if (!sub.expiresAt) return false;

	const exp =
		sub.expiresAt instanceof Date ? sub.expiresAt : new Date(sub.expiresAt);

	if (Number.isNaN(exp.getTime())) return false;

	return exp.getTime() > referenceDate.getTime();
}

function computeIsExpired(
	sub: SubscriptionLike,
	referenceDate: Date = new Date(),
): boolean {
	if (!sub.expiresAt) return false;

	const exp =
		sub.expiresAt instanceof Date ? sub.expiresAt : new Date(sub.expiresAt);

	if (Number.isNaN(exp.getTime())) return false;

	return exp.getTime() <= referenceDate.getTime();
}

function computeIsCanceled(sub: SubscriptionLike): boolean {
	return sub.subscriptionStatus === "CANCELED";
}

export class SubscriptionController {
	constructor(private subscriptionService: SubscriptionService) {}

	public async cancelSubscription(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const subscriptionId = Number(req.params.id);

			if (Number.isNaN(subscriptionId) || subscriptionId <= 0) {
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

			// Enriquecimento de resposta (não altera banco)
			const referenceDate = new Date();
			const payload = subscriptions.map((sub: any) => ({
				...sub,
				isCurrentlyActive: computeIsCurrentlyActive(sub, referenceDate),
				isExpired: computeIsExpired(sub, referenceDate),
				isCanceled: computeIsCanceled(sub),
			}));

			res.status(200).customJson(payload);
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

			const subscriptionId = Number(req.params.id);

			// Se sua rota não tiver :id, mantenha o fallback para data.id
			const finalId =
				!Number.isNaN(subscriptionId) && subscriptionId > 0
					? subscriptionId
					: Number(data.id);

			if (Number.isNaN(finalId) || finalId <= 0) {
				throw new AppError("ID de assinatura inválido", 400);
			}

			// Se ambos existirem e forem diferentes, é risco de inconsistência
			if (
				!Number.isNaN(subscriptionId) &&
				subscriptionId > 0 &&
				data?.id !== undefined &&
				data?.id !== null &&
				Number(data.id) !== subscriptionId
			) {
				throw new AppError(
					"Conflito de ID: o ID da rota é diferente do ID do payload",
					400,
				);
			}

			const updatedSubscription = await this.subscriptionService.updateSubscription(
				finalId,
				data,
			);

			res.status(200).customJson(updatedSubscription);
		} catch (error) {
			next(error);
		}
	}
}
