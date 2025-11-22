import type { User } from "../../entities/User";
import type { WashLocation } from "../../entities/WashLocation";
import { AppError } from "../../error/AppError";
import type { IUserRepository } from "../../repositories/interfaces/IUserRepository";
import type { IWashLocationRepository } from "../../repositories/interfaces/IWashLocationRepository";
import type { GetAllWashLocationsDTO } from "./dto/GetAllWashLocationsDTO";
import type { RegisterCompleteWashLocationDTO } from "./dto/RegisterCompleteWashLocationDTO";
import type { RegisterWashLocationDTO } from "./dto/RegisterWashLocationDTO";
import type { UpdateCompleteWashLocationDTO } from "./dto/UpdateCompleteWashLocationDTO";
import type { UpdateOpeningHoursDTO } from "./dto/UpdateOpeningHoursDTO";
import type { UpdateWashLocationDTO } from "./dto/UpdateWashLocationDTO";

export class WashLocationService {
	constructor(
		private washLocationRepository: IWashLocationRepository,
		private userRepository: IUserRepository,
	) {}

	public async registerWashLocation(
		data: RegisterWashLocationDTO,
	): Promise<WashLocation> {
		const existingLocation =
			await this.washLocationRepository.findByNameAndCity(data.name, data.city);
		if (existingLocation) {
			throw new AppError(
				"Já existe um local de lavagem com o mesmo nome nesta cidade",
				400,
			);
		}

		return await this.washLocationRepository.create(data);
	}

	public async listWashLocations(
		filter?: GetAllWashLocationsDTO,
		userId?: number,
	): Promise<WashLocation[]> {
		let user: User | null = null;
		if (userId) {
			user = await this.userRepository.findById(userId);
			if (!user) {
				throw new AppError("Usuário não encontrado", 404);
			}
		}

		return await this.washLocationRepository.findAll({
			userId: user?.role === "USER" ? user.id : undefined,
			// managerId: user?.role === 'MANAGER' ? user.id : undefined,
			...filter,
		});
	}

	public async updateServiceAvailability(
		locationId: number,
		serviceId: number,
		isAvailable: boolean,
	): Promise<WashLocation> {
		return await this.washLocationRepository.updateServiceAvailability(
			locationId,
			serviceId,
			isAvailable,
		);
	}

	public async updateFlow(
		locationId: number,
		flow: "LOW" | "MODERATE" | "HIGH",
	): Promise<WashLocation> {
		return await this.washLocationRepository.updateFlow(locationId, flow);
	}

	public async updateOpeningHours(
		locationId: number,
		openingHours: UpdateOpeningHoursDTO,
	): Promise<WashLocation> {
		// Transformar os horários de funcionamento para a estrutura esperada
		const transformedHours = openingHours.map((hour) => ({
			day: hour.dayOfWeek,
			open: hour.openTime,
			close: hour.closeTime,
		}));

		return await this.washLocationRepository.updateOpeningHours(
			locationId,
			transformedHours,
		);
	}

	public async listWashLocationsByManagerId(
		managerId: number,
	): Promise<WashLocation[]> {
		return await this.washLocationRepository.findAll({ managerId });
	}

	public async getWashLocationById(
		locationId: number,
		userId?: number,
	): Promise<WashLocation | null> {
		return await this.washLocationRepository.findByIdWithServices(
			locationId,
			userId,
		);
	}

	public async updateWashLocation(
		locationId: number,
		data: UpdateWashLocationDTO,
	): Promise<WashLocation> {
		const location =
			await this.washLocationRepository.findByIdWithServices(locationId);

		if (!location) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		// Se tentar atualizar nome e cidade, verificar se já existe outro local com esse nome na mesma cidade
		if (
			data.name &&
			data.city &&
			(data.name !== location.name || data.city !== location.city)
		) {
			const existingLocation =
				await this.washLocationRepository.findByNameAndCity(
					data.name,
					data.city,
				);
			if (existingLocation && existingLocation.id !== locationId) {
				throw new AppError(
					"Já existe um local de lavagem com o mesmo nome nesta cidade",
					400,
				);
			}
		}

		return await this.washLocationRepository.update(locationId, data);
	}

	public async registerCompleteWashLocation(
		data: RegisterCompleteWashLocationDTO,
	): Promise<WashLocation> {
		// Validação de nome e cidade duplicados
		const existingLocation =
			await this.washLocationRepository.findByNameAndCity(data.name, data.city);
		if (existingLocation) {
			throw new AppError(
				"Já existe um local de lavagem com o mesmo nome nesta cidade",
				400,
			);
		}

		// Criar localização com dados básicos
		const basicData = {
			name: data.name,
			images: data.images,
			street: data.street,
			number: data.number,
			neighborhood: data.neighborhood,
			city: data.city,
			phoneNumber: data.phoneNumber,
			managerId: data.managerId,
			flow: data.flow,
		};

		const washLocation = await this.washLocationRepository.create(basicData);

		// Processar horários de funcionamento, se fornecidos
		if (data.openingHours && data.openingHours.length > 0) {
			// Transformar para o formato esperado pelo repositório
			const transformedHours = data.openingHours.map((hour, index) => ({
				day: hour.dayOfWeek,
				index,
				open: hour.openTime,
				close: hour.closeTime,
			}));

			await this.washLocationRepository.updateOpeningHours(
				washLocation.id,
				transformedHours,
			);
		}

		// Processar disponibilidade de serviços, se fornecida
		if (data.services && data.services.length > 0) {
			for (const service of data.services) {
				await this.washLocationRepository.updateServiceAvailability(
					washLocation.id,
					service.serviceId,
					service.isAvailable,
				);
			}
		}

		// Buscar localização completa atualizada
		const updatedLocation =
			await this.washLocationRepository.findByIdWithServices(washLocation.id);
		if (!updatedLocation) {
			throw new AppError("Erro ao buscar localização atualizada", 500);
		}

		return updatedLocation;
	}

	public async updateCompleteWashLocation(
		locationId: number,
		data: UpdateCompleteWashLocationDTO,
	): Promise<WashLocation> {
		// Verificar se a localização existe
		const location =
			await this.washLocationRepository.findByIdWithServices(locationId);

		if (!location) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		// Se tentar atualizar nome e cidade, verificar se já existe outro local com esse nome na mesma cidade
		if (
			data.name &&
			data.city &&
			(data.name !== location.name || data.city !== location.city)
		) {
			const existingLocation =
				await this.washLocationRepository.findByNameAndCity(
					data.name,
					data.city,
				);
			if (existingLocation && existingLocation.id !== locationId) {
				throw new AppError(
					"Já existe um local de lavagem com o mesmo nome nesta cidade",
					400,
				);
			}
		}

		// Atualizar dados básicos
		const basicData = {
			...(data.managerId && { managerId: data.managerId }),
			...(data.name && { name: data.name }),
			...(data.images && { images: data.images }),
			...(data.street && { street: data.street }),
			...(data.number && { number: data.number }),
			...(data.neighborhood && { neighborhood: data.neighborhood }),
			...(data.city && { city: data.city }),
			...(data.phoneNumber && { phoneNumber: data.phoneNumber }),
			...(data.flow && { flow: data.flow }),
			...(typeof data.isActive === "boolean" && { isActive: data.isActive }),
		};

		// Atualizar localização com dados básicos, se houver
		if (Object.keys(basicData).length > 0) {
			await this.washLocationRepository.update(locationId, basicData);
		}

		// Atualizar horários de funcionamento, se fornecidos
		if (data.openingHours && data.openingHours.length > 0) {
			// Transformar para o formato esperado pelo repositório
			const transformedHours = data.openingHours.map((hour, index) => ({
				day: hour.dayOfWeek,
				index,
				open: hour.openTime,
				close: hour.closeTime,
			}));

			await this.washLocationRepository.updateOpeningHours(
				locationId,
				transformedHours,
			);
		}

		// Atualizar disponibilidade de serviços, se fornecida
		if (data.services && data.services.length > 0) {
			for (const service of data.services) {
				await this.washLocationRepository.updateServiceAvailability(
					locationId,
					service.serviceId,
					service.isAvailable,
				);
			}
		}

		// Buscar localização completa atualizada
		const updatedLocation =
			await this.washLocationRepository.findByIdWithServices(locationId);
		if (!updatedLocation) {
			throw new AppError("Erro ao buscar localização atualizada", 500);
		}

		return updatedLocation;
	}

	public async favoriteWashLocation(
		userId: number,
		locationId: number,
	): Promise<boolean> {
		const location = await this.washLocationRepository.findById(locationId);
		if (!location) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		const result = await this.washLocationRepository.favorite(
			userId,
			locationId,
		);

		return result !== null;
	}

	public async deleteWashLocation(locationId: number): Promise<void> {
		const location = await this.washLocationRepository.findById(locationId);
		if (!location) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}
		await this.washLocationRepository.delete(locationId);
	}
}
