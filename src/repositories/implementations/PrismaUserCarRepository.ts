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

	private toEntity(carData: any): UserCar {
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

	/**
	 * ✅ NOVO: placa por usuário
	 */
	async findByLicensePlateAndUserId(
		licensePlate: string,
		userId: number,
		includeInactive = false,
	): Promise<UserCar | null> {
		const normalized = this.normalizePlate(licensePlate);
		if (!normalized) return null;

		const carData = await prisma.car.findFirst({
			where: {
				userId,
				licensePlate: normalized,
				...(includeInactive ? {} : { deletedAt: null }),
			},
		});

		if (!carData) return null;
		return this.toEntity(carData);
	}

	/**
	 * (Opcional) útil pra relatórios/admin.
	 * ⚠️ Não use pra regra de unicidade.
	 */
	async findManyByLicensePlate(
		licensePlate: string,
		includeInactive = false,
	): Promise<UserCar[]> {
		const normalized = this.normalizePlate(licensePlate);
		if (!normalized) return [];

		const cars = await prisma.car.findMany({
			where: {
				licensePlate: normalized,
				...(includeInactive ? {} : { deletedAt: null }),
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});

		return cars.map((c) => this.toEntity(c));
	}

	async findByUserId(userId: number, includeInactive = false): Promise<UserCar[]> {
		const carData = await prisma.car.findMany({
			where: {
				userId,
				...(includeInactive ? {} : { deletedAt: null }),
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});

		return carData.map((car) => this.toEntity(car));
	}

	async findById(id: number, includeInactive = false): Promise<UserCar | null> {
		const carData = await prisma.car.findFirst({
			where: {
				id,
				...(includeInactive ? {} : { deletedAt: null }),
			},
		});

		if (!carData) return null;
		return this.toEntity(carData);
	}

	async create(
		data: Omit<UserCar, "id"> & { deletedAt?: Date | null },
	): Promise<UserCar> {
		const normalized = this.normalizePlate(data.licensePlate);

		if (!normalized || normalized.length !== 7) {
			throw new AppError("Placa inválida", 400);
		}

		/**
		 * ✅ NOVA REGRA:
		 * conflito só existe se já houver (placa + userId).
		 * E a checagem é sem filtrar deletedAt porque UNIQUE do banco pega ambos.
		 */
		const conflict = await prisma.car.findFirst({
			where: {
				userId: data.userId,
				licensePlate: normalized,
			},
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

		return this.toEntity(createdCar);
	}

	async update(carId: number, data: UpdateUserCarRepositoryDTO): Promise<UserCar> {
		// Admin pode atualizar inclusive inativos, então NÃO filtramos deletedAt aqui.
		const existing = await prisma.car.findFirst({
			where: { id: carId },
			select: { id: true, userId: true, licensePlate: true },
		});

		if (!existing) {
			throw new AppError("Carro não encontrado", 404);
		}

		// userId alvo para validação de unicidade (admin pode mudar owner)
		const targetUserId =
			(data as any).userId !== undefined && (data as any).userId !== null
				? Number((data as any).userId)
				: existing.userId;

		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			throw new AppError("userId inválido para atualização do veículo", 400);
		}

		// 1) Normalização/validação de placa + conflito (sem filtrar deletedAt)
		let normalizedPlate: string | undefined;

		if (data.licensePlate !== undefined) {
			const plateCandidate = this.normalizePlate(data.licensePlate);

			if (!plateCandidate || plateCandidate.length !== 7) {
				throw new AppError("Placa inválida", 400);
			}

			/**
			 * ✅ NOVA REGRA:
			 * conflito é por (placa + userId)
			 */
			const conflict = await prisma.car.findFirst({
				where: {
					userId: targetUserId,
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
		if ((data as any).userId !== undefined) updateData.userId = targetUserId;

		// deletedAt pode ser Date (desativar) OU null (reativar). Só ignora se for undefined.
		if (data.deletedAt !== undefined) updateData.deletedAt = data.deletedAt;

		const updatedCar = await prisma.car.update({
			where: { id: carId },
			data: updateData,
		});

		return this.toEntity(updatedCar);
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
