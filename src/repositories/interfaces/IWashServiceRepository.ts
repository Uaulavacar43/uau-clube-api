import type { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import type { WashService } from "../../entities/WashService";
import type { CreateWashServiceDTO } from "../../modules/wash-service/dto/CreateWashServiceDTO";
import type { ListTopSoldServicesDTO } from "../../modules/wash-service/dto/ListTopSoldServicesDTO";
import type { UpdateWashServiceDTO } from "../../modules/wash-service/dto/UpdateWashServiceDTO";

export interface IWashServiceRepository {
	findById(id: number): Promise<WashService | null>;
	create(data: CreateWashServiceDTO): Promise<WashService>;
	update(
		serviceId: number,
		data: UpdateWashServiceDTO,
		adminId: number,
	): Promise<WashService>;
	findManyByIds(ids: number[]): Promise<WashService[]>;
	delete(serviceId: number): Promise<void>;
	findAllWithLocations(
		page: number,
		pageSize: number,
		isPublished?: boolean,
		showPurchasedCount?: boolean,
		userId?: number,
	): Promise<{ services: WashService[]; total: number }>;
	findTopSoldServices(filters: ListTopSoldServicesDTO): Promise<{
		individualServicePurchase: IndividualServicePurchase[];
		total: number;
	}>;
}
