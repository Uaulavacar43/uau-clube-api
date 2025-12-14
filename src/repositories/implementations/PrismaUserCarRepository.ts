import prisma from "../../config/dbConfig";
import { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { UpdateUserCarDTO } from "../../modules/userCar/dto/UpdateUserCarDTO";
import type { IUserCarRepository } from "../interfaces/IUserCarRepository";

export class PrismaUserCarRepository implements IUserCarRepository {
	private normalizePlate(value: string): string {
		return (value ?? "")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "");
	}

	async findByLicensePlate(licensePlate: string): Promise<UserCar | null> {
		const normalized = this.normalizePlate(licensePlate);

		if (!normalized) return null;

		const carData = await prisma.car.findFirst({
			where: {
				licensePlate: normalized, // Prisma field -> @map("plate")
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
		const normalized = this.normalizePlate(data.licensePlate);

		if (!normalized || normalized.length !== 7) {
			throw new AppError("Placa inválida", 400);
		}

		const createdCar = await prisma.car.create({
			data: {
				licensePlate: normalized,
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
		const existing = await prisma.car.findFirst({
			where: { id: carId, deletedAt: null },
		});

		if (!existing) {
			throw new AppError("Carro não encontrado", 404);
		}

		let normalizedPlate: string | undefined = undefined;

		if (data.licensePlate) {
			normalizedPlate = this.normalizePlate(data.licensePlate);

			if (normalizedPlate.length !== 7) {
				throw new AppError("Placa inválida", 400);
			}

			const conflict = await prisma.car.findFirst({
				where: {
					deletedAt: null,
					licensePlate: normalizedPlate,
					NOT: { id: carId },
				},
				select: { id: true, userId: true },
			});

			if (conflict) {
				throw new AppError(
					"Já existe um carro ativo cadastrado com esta placa",
					409,
				);
			}
		}

		const updatedCar = await prisma.car.update({
			where: { id: carId },
			data: {
				licensePlate: normalizedPlate ?? undefined,
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
