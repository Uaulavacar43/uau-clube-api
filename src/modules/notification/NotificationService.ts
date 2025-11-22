import { getFirebaseAdmin } from "../../config/firebase";
import { Notification } from "../../entities/Notification";
import type { INotificationRepository } from "../../repositories/interfaces/INotificationRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import { SendNotificationDTO } from "./dto/SendNotificationDTO";

export class NotificationService {
	constructor(
		private notificationRepository: INotificationRepository,
		private userRepository: IUserRepository,
	) {}

	async sendNotification(
		data: SendNotificationDTO,
		type: "USER" | "MANAGER" | "ALL",
		isAutomatic = false,
	) {
		const tokens = await this.userRepository.getFirebaseTokensByType(type);

		if (tokens.length === 0) {
			console.warn(
				"Nenhum usuário encontrado com tokens Firebase válidos para enviar notificações.",
			);
			throw new Error("Nenhum usuário para enviar notificações");
		}

		try {
			const firebaseAdmin = getFirebaseAdmin();
			const messages = tokens.map((token) => ({
				notification: {
					title: data.title,
					body: data.description,
				},
				token,
			}));

			// Envia a notificação para cada token
			const response = await firebaseAdmin.messaging().sendEach(messages);

			response.responses.forEach((response) => {
				if (response.error) {
					console.log("=".repeat(50));
					console.error("Erro ao enviar notificação:", response.error);
					console.log({
						title: data.title,
						description: data.description,
						type,
						sentAt: new Date(),
					});
					console.log("=".repeat(50));
				}
			});

			// Salva a notificação no banco de dados
			await this.notificationRepository.save({
				title: data.title,
				description: data.description,
				type,
				sentAt: new Date(),
				isAutomatic,
				totalDelivered: response.successCount,
				totalFailed: response.failureCount,
				totalSent: response.responses.length,
			});

			console.log(
				`Notificação push enviada para ${tokens.length} tokens.\n`,
				response,
			);
		} catch (error) {
			console.error("Erro ao enviar notificações Firebase:", error);
		}
	}

	async listNotifications(): Promise<Notification[]> {
		const notifications = await this.notificationRepository.list();
		return notifications.map(
			(n) =>
				new Notification(
					n.id,
					n.title,
					n.description,
					n.type as "USER" | "MANAGER" | "ALL",
					n.sentAt,
					n.isAutomatic,
					n.totalSent,
					n.totalFailed,
					n.totalDelivered,
				),
		);
	}

	async notifyPendingPayments(): Promise<void> {
		const pendingUsers =
			await this.userRepository.getUsersWithPendingPayments();

		for (const user of pendingUsers) {
			const data = {
				title: "Pagamento Pendente",
				description: `Caro ${user.name}, você tem um pagamento pendente. Por favor, resolva-o em breve.`,
				type: "USER",
				isAutomatic: true,
			};

			const validData = SendNotificationDTO.parse(data);

			await this.sendNotification(validData, "USER", true); // isAutomatic = true
		}
	}

	async notifyExpiringSubscriptions(): Promise<void> {
		const expiringSubscriptions =
			await this.userRepository.findUsersWithExpiringSubscriptions();

		for (const { user, expiryDate } of expiringSubscriptions) {
			const data = {
				title: "Assinatura Próxima do Vencimento",
				description: `Caro ${user.name}, sua assinatura vencerá em ${expiryDate?.toDateString()}. Por favor, renove-a para continuar aproveitando nossos serviços.`,
				type: "USER",
				isAutomatic: true,
			};

			const validData = SendNotificationDTO.parse(data);

			await this.sendNotification(validData, "USER", true);
		}
	}
}
