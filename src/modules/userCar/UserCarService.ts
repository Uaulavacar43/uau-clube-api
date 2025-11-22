import type { User } from "../../entities/User";
import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";

export class UserCarService {
	constructor(
		private userCarRepository: IUserCarRepository,
		private subscriptionRepository: ISubscriptionRepository,
	) {}

	public async registerCar(
		data: RegisterUserCarDTO,
		userId: number,
	): Promise<UserCar> {
		const existingCar = await this.userCarRepository.findByLicensePlate(
			data.licensePlate,
		);
		if (existingCar) {
			throw new AppError("Carro com esta placa já está registrado", 400);
		}

		return await this.userCarRepository.create({
			...data,
			userId,
		});
	}

	public async listCars(userId: number): Promise<UserCar[]> {
		return await this.userCarRepository.findByUserId(userId);
	}

	public async updateCar(
		data: UpdateUserCarDTO,
		user: Pick<User, "id" | "role">,
	): Promise<UserCar> {
		const existingCar = await this.userCarRepository.findById(data.id);
		if (!existingCar) {
			throw new AppError("Carro não encontrado", 404);
		}

		if (user.role === "USER" && existingCar.userId !== user.id) {
			throw new AppError(
				"Você não está autorizado a atualizar este carro",
				403,
			);
		}

		return await this.userCarRepository.update(existingCar.id, data);
	}

	public async deleteCar(
		carId: number,
		user: Pick<User, "id" | "role">,
	): Promise<void> {
		const existingCar = await this.userCarRepository.findById(carId);
		if (!existingCar) {
			throw new AppError("Carro não encontrado", 404);
		}

		if (user.role === "USER" && existingCar.userId !== user.id) {
			throw new AppError("Você não está autorizado a excluir este carro", 403);
		}

		const subscriptionCar =
			await this.subscriptionRepository.findByCarLicensePlate(
				existingCar.licensePlate,
			);
		if (subscriptionCar?.isActive) {
			throw new AppError("Este veículo possui um plano ativo", 400);
		}

		await this.userCarRepository.delete(carId);
	}
}
