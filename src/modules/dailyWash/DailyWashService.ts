import type { DailyWash } from "../../entities/DailyWash";
import { AppError } from "../../error/AppError";
import type { IDailyWashRepository } from "../../repositories/interfaces/IDailyWashRepository";
import type { IIndividualServicePurchaseRepository } from "../../repositories/interfaces/IIndividualServicePurchaseRepository";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { IWashLocationRepository } from "../../repositories/interfaces/IWashLocationRepository";
import type { RegisterDailyWashDTO } from "./dto/RegisterDailyWashDTO";

export class DailyWashService {
	constructor(
		private dailyWashRepository: IDailyWashRepository,
		private userCarRepository: IUserCarRepository,
		private individualPurchaseRepo: IIndividualServicePurchaseRepository,
		private subscriptionRepository: ISubscriptionRepository,
		private washLocationRepository: IWashLocationRepository,
	) {}

	private normalizeLicensePlate(licensePlate: string): string {
		return (licensePlate ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
	}

	/**
	 * ✅ REGRA NOVA:
	 * placa não é mais globalmente única, então precisamos do userId
	 * (veio do token/autenticação).
	 */
	public async useDailyWash(
		data: RegisterDailyWashDTO,
		userId: number,
	): Promise<DailyWash> {
		const { licensePlate, washServiceId, washLocationId, timeZoneOffset } = data;

		if (!userId) {
			throw new AppError("Usuário inválido", 400);
		}

		if (washLocationId) {
			const washLocation = await this.washLocationRepository.findById(washLocationId);
			if (!washLocation) {
				throw new AppError("Local de lavagem não encontrado", 400);
			}
		}

		const plate = this.normalizeLicensePlate(licensePlate);

		if (!plate) {
			throw new AppError("Placa inválida", 400);
		}

		// ✅ agora busca por (placa + userId)
		const car = await this.userCarRepository.findByLicensePlateAndUserId(plate, userId, false);
		if (!car) {
			throw new AppError("Não existe um carro com a placa informada para este usuário.", 400);
		}

		// ✅ agora assinatura por (placa + userId)
		const loggedUserPlan =
			await this.subscriptionRepository.findByCarLicensePlateAndUserId(car.licensePlate, userId);

		if (!loggedUserPlan) {
			throw new AppError("Este veículo não possui um plano ativo", 400);
		}

		if (loggedUserPlan.expiresAt && loggedUserPlan.expiresAt < new Date()) {
			const date = loggedUserPlan.expiresAt.toLocaleDateString("pt-BR", {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
			});
			await this.subscriptionRepository.cancel(loggedUserPlan.id);
			throw new AppError("A assinatura deste veículo expirou em: " + date, 400);
		}

		const todayWash = await this.dailyWashRepository.findTodayWash(userId, timeZoneOffset);

		if (todayWash === 0) {
			if (!washServiceId) {
				throw new AppError(
					"Já foi utilizado o lava rápido diário; nenhum serviço avulso foi informado.",
					400,
				);
			}

			const existingPurchase = await this.individualPurchaseRepo.findByUserAndService(
				userId,
				washServiceId,
			);

			if (!existingPurchase || existingPurchase.status !== "COMPLETED" || !existingPurchase.id) {
				throw new AppError("Não existe um serviço avulso disponível para uso.", 400);
			}

			// (mantive tua lógica original — se aqui era pra consumir, normalmente seria outra transição,
			// mas não alterei regra)
			await this.individualPurchaseRepo.updateStatus(existingPurchase.id, "COMPLETED");
		}

		return await this.dailyWashRepository.create(car.id, washLocationId);
	}

	public async checkDailyWashAvailability(userId: number, timeZoneOffset?: number) {
		const todayWash = await this.dailyWashRepository.findTodayWash(userId, timeZoneOffset);
		return todayWash;
	}

	public async getUserWashHistory(
		userId: number,
		page: number = 1,
		pageSize: number = 10,
	): Promise<{ washes: DailyWash[]; total: number }> {
		if (!userId) {
			throw new AppError("ID do usuário é obrigatório", 400);
		}

		return await this.dailyWashRepository.getUserWashHistory(userId, page, pageSize);
	}
}
