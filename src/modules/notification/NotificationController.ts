import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { ListNotificationDTO } from "./dto/ListNotificationDTO";
import type { SendNotificationDTO } from "./dto/SendNotificationDTO";
import type { NotificationService } from "./NotificationService";

export class NotificationController {
	constructor(private notificationService: NotificationService) {}

	async sendNotification(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as SendNotificationDTO;

			if (!req.user) {
				throw new AppError("Você não tem permissão para isto", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			await this.notificationService.sendNotification(data, data.type);

			res
				.status(201)
				.customJson({ message: "Notificação enviada com sucesso." });
		} catch (error) {
			next(error);
		}
	}

	async listNotifications(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as ListNotificationDTO;

			if (!req.user) {
				throw new AppError("Você não tem permissão para isto", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			const notifications = await this.notificationService.listNotifications();
			res.status(200).customJson(notifications);
		} catch (error) {
			next(error);
		}
	}

	async sendAutomaticNotifications(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (!req.user) {
				throw new AppError("Você não tem permissão para isto", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			await this.notificationService.notifyPendingPayments();
			await this.notificationService.notifyExpiringSubscriptions();
			res
				.status(200)
				.customJson({
					message: "Notificações automáticas enviadas com sucesso.",
				});
		} catch (error) {
			next(error);
		}
	}

	async notifyPaymentStatus(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (!req.user) {
				throw new AppError("Você não tem permissão para isto", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			await this.notificationService.notifyPendingPayments();
			res.status(200).customJson({
				message: "Notificações de status de pagamento enviadas com sucesso.",
			});
		} catch (error) {
			next(error);
		}
	}

	async notifyUpcomingSubscriptionExpiry(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			if (!req.user) {
				throw new AppError("Você não tem permissão para isto", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			await this.notificationService.notifyExpiringSubscriptions();
			res.status(200).customJson({
				message:
					"Notificações de assinatura próxima ao vencimento enviadas com sucesso.",
			});
		} catch (error) {
			next(error);
		}
	}
}
