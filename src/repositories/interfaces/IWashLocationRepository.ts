import type { WashLocation } from "../../entities/WashLocation";
import type { RegisterWashLocationDTO } from "../../modules/washLocation/dto/RegisterWashLocationDTO";
import type { UpdateWashLocationDTO } from "../../modules/washLocation/dto/UpdateWashLocationDTO";

export interface FindAllFilter {
	userId?: number; // filtra favoritos da localidade pelo usuário final logado
	managerId?: number; // filtra localidades pelo gerente
	favorited?: boolean;
}

export interface IWashLocationRepository {
	create(data: RegisterWashLocationDTO): Promise<WashLocation>;
	update(
		locationId: number,
		data: UpdateWashLocationDTO,
	): Promise<WashLocation>;
	findByNameAndCity(name: string, city: string): Promise<WashLocation | null>;
	findAll(filter?: FindAllFilter): Promise<WashLocation[]>;
	updateServiceAvailability(
		locationId: number,
		serviceId: number,
		isAvailable: boolean,
	): Promise<WashLocation>;
	findByIdWithServices(
		locationId: number,
		userId?: number,
	): Promise<WashLocation | null>;
	updateFlow(
		locationId: number,
		flow: "LOW" | "MODERATE" | "HIGH",
	): Promise<WashLocation>;
	updateOpeningHours(
		locationId: number,
		openingHours: { day: string; open: string; close: string }[],
	): Promise<WashLocation>;
	findAllByManagerId(managerId: number): Promise<WashLocation[]>;
	findById(locationId: number): Promise<WashLocation | null>;
	favorite(userId: number, locationId: number): Promise<number | null>;
	delete(locationId: number): Promise<void>;
}
