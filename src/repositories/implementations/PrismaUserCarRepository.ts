import prisma from "../../config/dbConfig";
import { UserCar } from "../../entities/UserCar";
import type { UpdateUserCarDTO } from "../../modules/userCar/dto/UpdateUserCarDTO";
import type { IUserCarRepository } from "../interfaces/IUserCarRepository";

export class PrismaUserCarRepository implements IUserCarRepository {
	async findByLicensePlate(licensePlate: string): Promise<UserCar | null> {
		const carData = await prisma.car.findFirst({
			where: {
				plate: licensePlate,
				deletedAt: null,
			},
		});
		if (!carData) {
			return null;
		}

		return new UserCar(
			carData.id,
			carData.plate,
			carData.color,
			carData.model,
			carData.brand,
			carData.year,
			carData.userId,
		);
	}

	async create(data: UserCar): Promise<UserCar> {
		const createdCar = await prisma.car.create({
			data: {
				plate: data.licensePlate,
				color: data.color,
				model: data.model,
				brand: data.brand,
				year: data.year,
				userId: data.userId,
			},
		});

		return new UserCar(
			createdCar.id,
			createdCar.plate,
			createdCar.color,
			createdCar.model,
			createdCar.brand,
			createdCar.year,
			createdCar.userId,
		);
	}

	async findByUserId(userId: number): Promise<UserCar[]> {
		const carData = await prisma.car.findMany({
			where: {
				userId,
				deletedAt: null,
			},
		});
		return carData.map(
			(car) =>
				new UserCar(
					car.id,
					car.plate,
					car.color,
					car.model,
					car.brand,
					car.year,
					car.userId,
				),
		);
	}

	async findById(id: number): Promise<UserCar | null> {
		const carData = await prisma.car.findFirst({
			where: {
				id,
				deletedAt: null,
			},
		});
		if (!carData) {
			return null;
		}
		return new UserCar(
			carData.id,
			carData.plate,
			carData.color,
			carData.model,
			carData.brand,
			carData.year,
			carData.userId,
		);
	}

	async update(carId: number, data: UpdateUserCarDTO): Promise<UserCar> {
		const updatedCar = await prisma.car.update({
			where: { id: carId, deletedAt: null },
			data: {
				plate: data.licensePlate ?? undefined,
				color: data.color ?? undefined,
				model: data.model ?? undefined,
				brand: data.brand ?? undefined,
				year: data.year ?? undefined,
			},
		});

		return new UserCar(
			updatedCar.id,
			updatedCar.plate,
			updatedCar.color,
			updatedCar.model,
			updatedCar.brand,
			updatedCar.year,
			updatedCar.userId,
		);
	}

	async delete(carId: number): Promise<void> {
		await prisma.car.update({
			where: { id: carId },
			data: { deletedAt: new Date() },
		});
	}
}
