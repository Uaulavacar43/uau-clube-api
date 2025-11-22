import type { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import type { WashService } from "../../entities/WashService";
import { AppError } from "../../error/AppError";
import type { IWashServiceRepository } from "../../repositories/interfaces/IWashServiceRepository";
import type { CreateWashServiceDTO } from "./dto/CreateWashServiceDTO";
import type { ListTopSoldServicesDTO } from "./dto/ListTopSoldServicesDTO";
import type { UpdateWashServiceDTO } from "./dto/UpdateWashServiceDTO";

export class WashServiceService {
	constructor(private washServiceRepository: IWashServiceRepository) {}

	public async create(data: CreateWashServiceDTO): Promise<WashService> {
		return await this.washServiceRepository.create(data);
	}

	public async update(
		serviceId: number,
		data: UpdateWashServiceDTO,
		adminId: number,
	): Promise<WashService> {
		const existingService =
			await this.washServiceRepository.findById(serviceId);
		if (!existingService) {
			throw new AppError("Serviço não encontrado", 404);
		}

		// Chamamos `update` no repositório sem incluir `adminId` no objeto `data`
		return await this.washServiceRepository.update(serviceId, data, adminId);
	}

	public async delete(serviceId: number, adminId: number): Promise<void> {
		const existingService =
			await this.washServiceRepository.findById(serviceId);
		if (!existingService) {
			throw new AppError("Serviço não encontrado", 404);
		}
		await this.washServiceRepository.delete(serviceId);
	}

	public async listServicesWithLocations(
		page: number,
		pageSize: number,
		isPublished?: boolean,
		showPurchasedCount?: boolean,
		userId?: number,
	): Promise<{ services: WashService[]; totalPages: number }> {
		const { services, total } =
			await this.washServiceRepository.findAllWithLocations(
				page,
				pageSize,
				isPublished,
				showPurchasedCount,
				userId,
			);
		const totalPages = Math.ceil(total / pageSize);
		return { services, totalPages };
	}

	public async listTopSoldServices(filters: ListTopSoldServicesDTO): Promise<{
		individualServicePurchase: IndividualServicePurchase[];
		totalPages: number;
	}> {
		const { individualServicePurchase, total } =
			await this.washServiceRepository.findTopSoldServices(filters);
		const totalPages = Math.ceil(total / filters.pageSize);
		return { individualServicePurchase, totalPages };
	}

	public async getServiceById(serviceId: number): Promise<WashService> {
		const service = await this.washServiceRepository.findById(serviceId);
		if (!service) {
			throw new AppError("Serviço não encontrado", 404);
		}
		return service;
	}
}
