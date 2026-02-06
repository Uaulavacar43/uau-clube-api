import { envConfig } from "../../config/envConfig";
import { warnAdminSubscription } from "../../emails/warnAdminSubscription";
import type { Subscription } from "../../entities/Subscription";
import { AppError } from "../../error/AppError";
import type { MailingQueue } from "../../queues/MailingQueue";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import { asaasCancelSubscription } from "../../utils/asaas/asaasSubscriptions";
import type { ActivateSubscriptionDTO } from "./dto/ActivateSubscriptionDTO";
import type { UpdateSubscriptionDTO } from "./dto/UpdateSubscriptionDTO";

export class SubscriptionService {
	constructor(
		private subscriptionRepository: ISubscriptionRepository,
		private carRepository: IUserCarRepository,
		private planRepository: IPlanRepository,
		private userRepository: IUserRepository,
		private mailingQueue: MailingQueue,
	) {}

	// Função para registrar uma nova assinatura para o carro de um usuário
	// public async registerSubscription(data: RegisterSubscriptionDTO): Promise<Subscription> {
	// 	const existingSubscription = await this.subscriptionRepository.findByUserAndCar(data.userId, data.carId);
	// 	if (existingSubscription) {
	// 		throw new AppError('Assinatura já existe para este carro', 400);
	// 	}
	// 	return await this.subscriptionRepository.create(data);
	// }

	// Função para cancelar uma assinatura existente
	public async cancelSubscription(subscriptionId: number): Promise<void> {
		const subscription =
			await this.subscriptionRepository.findById(subscriptionId);
		if (!subscription || !subscription.isActive || !subscription.planId) {
			throw new AppError("Assinatura não encontrada ou já está inativa", 404);
		}
		const plan = await this.planRepository.findById(subscription.planId);
		if (!plan) {
			throw new AppError("Plano não encontrado", 404);
		}

		const user = await this.userRepository.findById(subscription.userId);
		if (!user) {
			throw new AppError("Usuário não encontrado", 404);
		}

		if (subscription.expiresAt && subscription.expiresAt > new Date()) {
			throw new AppError(
				"Você não pode cancelar uma assinatura que ainda não expirou",
				400,
			);
		}

		const { html, text, subject } = warnAdminSubscription(
			`${user.name} (ID: ${user.id})`,
		);
		if (!subscription.subscriptionIdAsaas && !plan.isPackage) {
			this.mailingQueue.addToQueue({
				to: envConfig.MAILER_ADMIN_EMAIL,
				subject,
				text,
				html,
			});
		} else {
			if (!subscription.subscriptionIdAsaas) {
				this.mailingQueue.addToQueue({
					to: envConfig.MAILER_ADMIN_EMAIL,
					subject,
					text,
					html,
				});
			} else if (!plan.isPackage) {
				await asaasCancelSubscription(subscription.subscriptionIdAsaas);
			}
		}

		await this.subscriptionRepository.cancel(subscriptionId);
	}

	// Função para atualizar uma assinatura existente
	public async updateSubscription(
		subscriptionId: number,
		data: UpdateSubscriptionDTO,
	): Promise<Subscription> {
		const subscription =
			await this.subscriptionRepository.findById(subscriptionId);
		if (!subscription) {
			throw new AppError("Assinatura não encontrada", 404);
		}

		const car = await this.carRepository.findById(data.carId);
		if (!car) {
			throw new AppError("Veículo não encontrado", 404);
		}

		// if (!subscription.isActive) {
		// 	throw new AppError(
		// 		"Assinatura está inativa e não pode ser atualizada",
		// 		400,
		// 	);
		// }

		return await this.subscriptionRepository.update(subscriptionId, {
			carId: car.id,
		});
	}

	// Função para renovar uma assinatura existente
	// public async renewSubscription(subscriptionId: number): Promise<Subscription> {
	//   const subscription = await this.subscriptionRepository.findById(subscriptionId);
	//   if (!subscription) {
	//     throw new AppError('Assinatura não encontrada', 404);
	//   }

	//   if (!subscription.isActive) {
	//     throw new AppError('Assinatura está inativa e não pode ser renovada', 400);
	//   }

	//   const newEndDate = subscription.plan === 'MONTHLY'
	//     ? new Date(subscription.endDate.getTime() + 30 * 24 * 60 * 60 * 1000)
	//     : new Date(subscription.endDate.getTime() + 365 * 24 * 60 * 60 * 1000);

	//   return await this.subscriptionRepository.update(subscriptionId, {
	//     endDate: newEndDate,
	//   });
	// }

	// Função para listar assinaturas de um usuário
	public async listSubscriptions(userId: number): Promise<Subscription[]> {
		return await this.subscriptionRepository.findByUserId(userId, true);
	}

	public async activateSubscription(
		subscriptionId: number,
		data: ActivateSubscriptionDTO,
	): Promise<Subscription> {
		const subscription =
			await this.subscriptionRepository.findById(subscriptionId);
		if (!subscription) {
			throw new AppError("Assinatura não encontrada", 404);
		}

		let planId = data.planId || subscription.planId;
		let amount = subscription.amount || 0;

		if (planId) {
			const plan = await this.planRepository.findById(planId);
			if (plan) {
				amount = plan.price || 0;
			}
		}

		const now = new Date();
		const startDate = data.startDate ? new Date(data.startDate) : now;
		
		let endDate: Date;
		if (data.endDate) {
			endDate = new Date(data.endDate);
		} else {
			endDate = new Date(startDate);
			const planType = subscription.planType?.toUpperCase() || "MONTH";
			
			switch (planType) {
				case "QUARTER":
				case "QUARTERLY":
				case "TRIMESTER":
				case "TRIMESTRAL":
					endDate.setMonth(endDate.getMonth() + 3);
					break;
				case "SEMESTER":
				case "SEMESTRAL":
				case "SEMIANNUAL":
					endDate.setMonth(endDate.getMonth() + 6);
					break;
				case "YEAR":
				case "YEARLY":
				case "ANNUAL":
					endDate.setFullYear(endDate.getFullYear() + 1);
					break;
				default:
					endDate.setMonth(endDate.getMonth() + 1);
					break;
			}
		}

		return await this.subscriptionRepository.update(subscriptionId, {
			isActive: true,
			startDate,
			endDate,
			expiresAt: endDate,
			planId,
			amount,
		});
	}
}
