import prisma from "../../config/dbConfig";
import { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { UpdateUserCarDTO } from "../../modules/userCar/dto/UpdateUserCarDTO";
import type { IUserCarRepository } from "../interfaces/IUserCarRepository";

export class PrismaUserCarRepository implements IUserCarRepository {
	async findByLicensePlate(licensePlate: string): Promise<UserCar | null> {
		const carData = await prisma.car.findFirst({
			where: {
				licensePlate, // (Prisma field) -> mapeado para coluna plate
				deletedAt: null,
			},
		});

		if (!carData) return null;

		return new UserCar(
			carData.id,
			carData.licensePlate,
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
				licensePlate: data.licensePlate, // (Prisma field) -> coluna plate
				color: data.color,
				model: data.model,
				brand: data.brand,
				year: data.year,
				userId: data.userId,
			},
		});

		return new UserCar(
			createdCar.id,
			createdCar.licensePlate,
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
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});

		return carData.map(
			(car) =>
				new UserCar(
					car.id,
					car.licensePlate,
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

		if (!carData) return null;

		return new UserCar(
			carData.id,
			carData.licensePlate,
			carData.color,
			carData.model,
			carData.brand,
			carData.year,
			carData.userId,
		);
	}

	async update(carId: number, data: UpdateUserCarDTO): Promise<UserCar> {
		// Garante que não atualiza carro deletado (e evita "where unique com deletedAt")
		const existing = await prisma.car.findFirst({
			where: { id: carId, deletedAt: null },
		});

		if (!existing) {
			throw new AppError("Carro não encontrado", 404);
		}

		const updatedCar = await prisma.car.update({
			where: { id: carId },
			data: {
				licensePlate: data.licensePlate ?? undefined,
				color: data.color ?? undefined,
				model: data.model ?? undefined,
				brand: data.brand ?? undefined,
				year: data.year ?? undefined,
				updatedAt: new Date(),
			},
		});

		return new UserCar(
			updatedCar.id,
			updatedCar.licensePlate,
			updatedCar.color,
			updatedCar.model,
			updatedCar.brand,
			updatedCar.year,
			updatedCar.userId,
		);
	}

	async delete(carId: number): Promise<void> {
		// Garante idempotência e mensagem clara
		const existing = await prisma.car.findFirst({
			where: { id: carId, deletedAt: null },
			select: { id: true },
		});

		if (!existing) {
			throw new AppError("Carro não encontrado", 404);
		}

		await prisma.car.update({
			where: { id: carId },
			data: { deletedAt: new Date(), updatedAt: new Date() },
		});
	}
}
