import prisma from "../../config/dbConfig";
import { Notification } from "../../entities/Notification";
import type { INotificationRepository } from "../interfaces/INotificationRepository";

export class PrismaNotificationRepository implements INotificationRepository {
	async save(data: Omit<Notification, "id">): Promise<Notification> {
		const createdNotification = await prisma.notification.create({
			data: {
				...data,
				isAutomatic: data.isAutomatic ?? false, // Asegura que se defina el campo
			},
		});

		return new Notification(
			createdNotification.id,
			createdNotification.title,
			createdNotification.description,
			createdNotification.type as "USER" | "MANAGER" | "ALL",
			createdNotification.sentAt,
			createdNotification.isAutomatic,
			createdNotification.totalSent,
			createdNotification.totalFailed,
			createdNotification.totalDelivered,
		);
	}

	async saveMany(data: Omit<Notification, "id">[]): Promise<number> {
		const createdNotifications = await prisma.notification.createMany({
			data,
		});

		return createdNotifications.count;
	}

	async list(): Promise<Notification[]> {
		const notifications = await prisma.notification.findMany({
			orderBy: {
				sentAt: "desc",
			},
		});

		return notifications.map(
			(n) =>
				new Notification(
					n.id,
					n.title,
					n.description,
					n.type as "USER" | "MANAGER" | "ALL",
					n.sentAt,
					Boolean(n.isAutomatic),
					n.totalSent,
					n.totalFailed,
					n.totalDelivered,
				),
		);
	}

	async getExpiringSubscriptions(): Promise<
		{
			userId: number;
			userName: string;
			expiryDate: Date | null;
		}[]
	> {
		const upcomingExpiryDate = new Date();
		upcomingExpiryDate.setDate(upcomingExpiryDate.getDate() + 7);

		const expiringSubscriptions = await prisma.subscription.findMany({
			where: {
				isActive: true,
				expiresAt: {
					lte: upcomingExpiryDate,
				},
			},
			select: {
				userId: true,
				user: {
					select: {
						name: true,
					},
				},
				expiresAt: true,
			},
		});

		return expiringSubscriptions.map((subscription) => ({
			userId: subscription.userId,
			userName: subscription.user.name,
			expiryDate: subscription.expiresAt,
		}));
	}
}
