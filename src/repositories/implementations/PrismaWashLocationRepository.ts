import prisma from "../../config/dbConfig";
import { WashLocation } from "../../entities/WashLocation";
import { AppError } from "../../error/AppError";
import type { RegisterWashLocationDTO } from "../../modules/washLocation/dto/RegisterWashLocationDTO";
import type { UpdateCompleteWashLocationDTO } from "../../modules/washLocation/dto/UpdateCompleteWashLocationDTO";
import type {
	FindAllFilter,
	IWashLocationRepository,
} from "../interfaces/IWashLocationRepository";

export class PrismaWashLocationRepository implements IWashLocationRepository {
	async create(data: RegisterWashLocationDTO): Promise<WashLocation> {
		const createdLocation = await prisma.washLocation.create({
			data: {
				name: data.name,
				managerId: data.managerId,
				images: data.images,
				street: data.street,
				number: data.number,
				neighborhood: data.neighborhood,
				city: data.city,
				phoneNumber: data.phoneNumber ?? null,
				rateQtd: 0,
				rateValue: 0.0,
				flow: data.flow,
			},
		});
		const allServices = await prisma.washService.findMany();
		for (const service of allServices) {
			await prisma.locationService.create({
				data: {
					washLocationId: createdLocation.id,
					washServiceId: service.id,
					isAvailable: true,
				},
			});
		}

		const locationWithServices = await this.findByIdWithServices(
			createdLocation.id,
		);
		if (!locationWithServices) {
			throw new AppError("Failed to create wash location with services", 500);
		}

		return locationWithServices;
	}

	async findByNameAndCity(
		name: string,
		city: string,
	): Promise<WashLocation | null> {
		const location = await prisma.washLocation.findFirst({
			where: {
				name,
				city,
				deletedAt: null,
			},
			include: {
				services: { include: { washService: true } },
				openingHours: true,
			},
		});
		return location ? this.mapWashLocation(location) : null;
	}

	async findAll(filter?: FindAllFilter): Promise<WashLocation[]> {
		const { userId, managerId, favorited } = filter || {};

		const prismaLocations = await prisma.washLocation.findMany({
			where: {
				deletedAt: null,
				managerId,
			},
			include: {
				services: { include: { washService: true } },
				openingHours: true,
				manager: true,
			},
		});

		const locations = prismaLocations.map((location) =>
			this.mapWashLocation(location),
		);

		for (let i = 0; i < locations.length; i++) {
			if (userId) {
				const favorited = await prisma.washLocationFavorite.findFirst({
					where: { userId, washLocationId: locations[i].id },
				});

				locations[i].totalFavorites = favorited ? 1 : 0;
				locations[i].isFavorited = favorited ? true : false;

				continue;
			}

			const countFavorites = await prisma.washLocationFavorite.count({
				where: { washLocationId: locations[i].id },
			});
			locations[i].totalFavorites = countFavorites;
		}

		return locations
			.filter((location) => (favorited && userId ? location.isFavorited : true))
			.sort((a, b) => (a.isFavorited ? -1 : 1));
	}

	async updateServiceAvailability(
		locationId: number,
		serviceId: number,
		isAvailable: boolean,
	): Promise<WashLocation> {
		const existingRelation = await prisma.locationService.findUnique({
			where: {
				washLocationId_washServiceId: {
					washLocationId: locationId,
					washServiceId: serviceId,
				},
			},
		});

		if (!existingRelation) {
			throw new AppError("Service relation not found", 404);
		}

		await prisma.locationService.update({
			where: {
				washLocationId_washServiceId: {
					washLocationId: locationId,
					washServiceId: serviceId,
				},
			},
			data: { isAvailable },
		});

		const updatedLocation = await this.findByIdWithServices(locationId);
		if (!updatedLocation) {
			throw new AppError("Erro ao atualizar disponibilidade do serviço", 500);
		}

		return updatedLocation;
	}

	async findByIdWithServices(
		locationId: number,
		userId?: number,
	): Promise<WashLocation> {
		const location = await prisma.washLocation.findUnique({
			where: {
				id: locationId,
				deletedAt: null,
			},
			include: {
				services: { include: { washService: true } },
				openingHours: true,
				manager: true,
			},
		});

		if (!location) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		const mappedLocation = this.mapWashLocation(location);

		if (userId) {
			const favorited = await prisma.washLocationFavorite.findFirst({
				where: { userId, washLocationId: locationId },
			});

			mappedLocation.totalFavorites = favorited ? 1 : 0;
			mappedLocation.isFavorited = favorited ? true : false;
		} else {
			const countFavorites = await prisma.washLocationFavorite.count({
				where: { washLocationId: locationId },
			});
			mappedLocation.totalFavorites = countFavorites;
		}

		return mappedLocation;
	}

	async updateFlow(
		locationId: number,
		flow: "LOW" | "MODERATE" | "HIGH",
	): Promise<WashLocation> {
		const updatedLocation = await prisma.washLocation.update({
			where: { id: locationId },
			data: { flow },
			include: {
				services: { include: { washService: true } },
				openingHours: true,
			},
		});

		if (!updatedLocation) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		return this.mapWashLocation(updatedLocation);
	}

	async findAllByManagerId(managerId: number): Promise<WashLocation[]> {
		const locations = await prisma.washLocation.findMany({
			where: {
				managerId,
				deletedAt: null,
			},
			include: {
				services: { include: { washService: true } },
				openingHours: true,
			},
		});
		return locations.map(this.mapWashLocation);
	}

	async updateOpeningHours(
		locationId: number,
		openingHours: {
			day: string;
			index: number;
			open: string;
			close: string;
			breakOpen?: string;
			breakClose?: string;
		}[],
	): Promise<WashLocation> {
		await prisma.openingHour.deleteMany({
			where: { washLocationId: locationId },
		});

		for (const hour of openingHours) {
			await prisma.openingHour.create({
				data: {
					washLocationId: locationId,
					day: hour.day,
					index: hour.index,
					open: hour.open,
					close: hour.close,
					breakOpen: hour.breakOpen ?? null,
					breakClose: hour.breakClose ?? null,
				},
			});
		}

		return this.findByIdWithServices(locationId);
	}

	async update(
		locationId: number,
		data: UpdateCompleteWashLocationDTO,
	): Promise<WashLocation> {
		const existingLocation = await prisma.washLocation.findUnique({
			where: { id: locationId },
		});

		if (!existingLocation) {
			throw new AppError("Local de lavagem não encontrado", 404);
		}

		const updatedLocation = await prisma.washLocation.update({
			where: { id: locationId },
			data: {
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
			},
			include: {
				services: { include: { washService: true } },
				openingHours: true,
			},
		});

		return this.mapWashLocation(updatedLocation);
	}

	private mapWashLocation(location: any): WashLocation {
		return new WashLocation(
			location.id,
			location.name,
			location.managerId,
			location.images,
			location.street,
			location.number,
			location.neighborhood,
			location.city,
			location.flow,
			location.phoneNumber,
			location.isActive,
			location.services?.map((service: any) => ({
				id: service.washService.id,
				name: service.washService.name,
				price: service.washService.price,
				imageUrl: service.washService.imageUrl,
				isAvailable: service.isAvailable,
				adminId: service.washService.adminId,
			})) ?? [],
			location.openingHours?.map((hour: any) => ({
				day: hour.day,
				open: hour.open,
				close: hour.close,
			})) ?? [],
			location.totalFavorites,
			location.isFavorited,
			!location.manager
				? undefined
				: {
						...location.manager,
						password: undefined,
						otp: undefined,
						firebaseTokens: undefined,
					},
		);
	}

	async findById(locationId: number): Promise<WashLocation | null> {
		const location = await prisma.washLocation.findUnique({
			where: {
				id: locationId,
				deletedAt: null,
			},
			include: {
				services: { include: { washService: true } },
			},
		});

		if (!location) return null;
		return this.mapWashLocation(location);
	}

	async favorite(userId: number, locationId: number): Promise<number | null> {
		const exists = await prisma.washLocationFavorite.findFirst({
			where: {
				userId,
				washLocationId: locationId,
			},
		});

		if (!exists) {
			const result = await prisma.washLocationFavorite.create({
				data: {
					userId,
					washLocationId: locationId,
				},
			});

			return result.id;
		}

		await prisma.washLocationFavorite.delete({
			where: {
				id: exists.id,
			},
		});

		return null;
	}

	async delete(locationId: number): Promise<void> {
		// Soft delete - apenas atualiza o campo deletedAt
		await prisma.washLocation.update({
			where: {
				id: locationId,
				deletedAt: null,
			},
			data: {
				deletedAt: new Date(),
				isActive: false, // Desativa a unidade quando é deletada
			},
		});
	}

	async updateStatus(
		locationId: number,
		isActive: boolean,
	): Promise<WashLocation> {
		const updatedLocation = await prisma.washLocation.update({
			where: { id: locationId },
			data: { isActive },
			include: {
				services: { include: { washService: true } },
				openingHours: true,
			},
		});

		return this.mapWashLocation(updatedLocation);
	}
}
