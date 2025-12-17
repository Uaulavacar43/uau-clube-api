import prisma from "../../config/dbConfig";
import { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type {
	IUserCarRepository,
	UpdateUserCarRepositoryDTO,
} from "../interfaces/IUserCarRepository";

export class PrismaUserCarRepository implements IUserCarRepository {
	private normalizePlate(value: string): string {
		return (value ?? "")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "");
	}

	async findByLicensePlate(
		licensePlate: string,
		includeInactive = false,
	): Promise<UserCar | null> {
		const normalized = this.normalizePlate(licensePlate);
		if (!normalized) return null;

		const carData = await prisma.car.findFirst({
			where: {
				licensePlate: normalized,
				...(includeInactive ? {} : { deletedAt: null }),
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

	async findByUserId(userId: number, includeInactive = false): Promise<UserCar[]> {
		const carData = await prisma.car.findMany({
			where: {
				userId,
				...(includeInactive ? {} : { deletedAt: null }),
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

	async findById(id: number, includeInactive = false): Promise<UserCar | null> {
		const carData = await prisma.car.findFirst({
			where: {
				id,
				...(includeInactive ? {} : { deletedAt: null }),
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

	async create(
		data: Omit<UserCar, "id"> & { deletedAt?: Date | null },
	): Promise<UserCar> {
		const normalized = this.normalizePlate(data.licensePlate);

		if (!normalized || normalized.length !== 7) {
			throw new AppError("Placa inválida", 400);
		}

		/**
		 * IMPORTANTE:
		 * Se existir UNIQUE no banco, placa desativada também bloqueia reuso.
		 * Então checamos conflito SEM filtrar deletedAt.
		 */
		const conflict = await prisma.car.findFirst({
			where: { licensePlate: normalized },
			select: { id: true, deletedAt: true },
		});

		if (conflict) {
			if (conflict.deletedAt) {
				throw new AppError(
					"Carro com esta placa já está registrado (desativado). Reative pelo painel.",
					409,
				);
			}
			throw new AppError("Carro com esta placa já está registrado", 409);
		}

		const createdCar = await prisma.car.create({
			data: {
				licensePlate: normalized,
				color: data.color,
				model: data.model,
				brand: data.brand,
				year: data.year,
				userId: data.userId,
				deletedAt: data.deletedAt ?? null,
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

	async update(carId: number, data: UpdateUserCarRepositoryDTO): Promise<UserCar> {
		// Admin pode atualizar inclusive inativos, então NÃO filtramos deletedAt aqui.
		const existing = await prisma.car.findFirst({
			where: { id: carId },
			select: { id: true },
		});

		if (!existing) {
			throw new AppError("Carro não encontrado", 404);
		}

		// 1) Normalização/validação de placa + conflito (sem filtrar deletedAt)
		let normalizedPlate: string | undefined;

		if (data.licensePlate !== undefined) {
			const plateCandidate = this.normalizePlate(data.licensePlate);

			if (!plateCandidate || plateCandidate.length !== 7) {
				throw new AppError("Placa inválida", 400);
			}

			const conflict = await prisma.car.findFirst({
				where: {
					licensePlate: plateCandidate,
					NOT: { id: carId },
				},
				select: { id: true, deletedAt: true },
			});

			if (conflict) {
				if (conflict.deletedAt) {
					throw new AppError(
						"Já existe um carro cadastrado com esta placa (desativado). Reative pelo painel.",
						409,
					);
				}
				throw new AppError("Já existe um carro cadastrado com esta placa", 409);
			}

			normalizedPlate = plateCandidate;
		}

		// 2) Monta payload de update SEM “engolir” null (ex.: deletedAt=null para reativar)
		const updateData: Record<string, any> = {
			updatedAt: new Date(),
		};

		if (normalizedPlate !== undefined) updateData.licensePlate = normalizedPlate;

		if (data.color !== undefined) updateData.color = data.color;
		if (data.model !== undefined) updateData.model = data.model;
		if (data.brand !== undefined) updateData.brand = data.brand;
		if (data.year !== undefined) updateData.year = data.year;

		// ADMIN features
		if ((data as any).userId !== undefined) updateData.userId = (data as any).userId;

		// deletedAt pode ser Date (desativar) OU null (reativar). Só ignora se for undefined.
		if (data.deletedAt !== undefined) updateData.deletedAt = data.deletedAt;

		const updatedCar = await prisma.car.update({
			where: { id: carId },
			data: updateData,
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
		// Soft delete: pode marcar deletedAt mesmo se já estiver desativado (best-effort)
		const existing = await prisma.car.findFirst({
			where: { id: carId },
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
