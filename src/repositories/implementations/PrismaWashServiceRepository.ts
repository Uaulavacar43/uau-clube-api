import type {
	Prisma,
	IndividualServicePurchase as PrismaIndividualServicePurchase,
	Payment as PrismaPayment,
	User as PrismaUser,
	WashLocation as PrismaWashLocation,
	WashService as PrismaWashService,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import { Payment } from "../../entities/Payment";
import { User } from "../../entities/User";
import { WashLocation } from "../../entities/WashLocation";
import { WashService } from "../../entities/WashService";
import { AppError } from "../../error/AppError";
import type { CreateWashServiceDTO } from "../../modules/wash-service/dto/CreateWashServiceDTO";
import type { ListTopSoldServicesDTO } from "../../modules/wash-service/dto/ListTopSoldServicesDTO";
import type { UpdateWashServiceDTO } from "../../modules/wash-service/dto/UpdateWashServiceDTO";
import type { IWashServiceRepository } from "../interfaces/IWashServiceRepository";

interface MappingService extends PrismaWashService {
	locations?: { washLocation: PrismaWashLocation }[];
	individualServicePurchases?: PrismaIndividualServicePurchase[];
}

interface MappingIndividualServicePurchase
	extends PrismaIndividualServicePurchase {
	washService?: PrismaWashService;
	payment?: PrismaPayment | null;
	user?: PrismaUser;
}

export class PrismaWashServiceRepository implements IWashServiceRepository {
	async findById(id: number): Promise<WashService | null> {
		const washServiceData = await prisma.washService.findUnique({
			where: { id },
			include: {
				locations: {
					include: {
						washLocation: true,
					},
				},
			},
		});

		return washServiceData ? this.mapWashService(washServiceData) : null;
	}

	async create(data: CreateWashServiceDTO): Promise<WashService> {
		if (!data.adminId) {
			throw new AppError("Admin ID is required to create a wash service", 400);
		}

		// Iniciamos una transacción para asegurar que todas las operaciones sean atómicas
		const createdService = await prisma.$transaction(async (prisma) => {
			// Crear el nuevo servicio de lavado
			const service = await prisma.washService.create({
				data: {
					name: data.name,
					price: data.price,
					imageUrl: data.imageUrl!,
					isAvailable:
						typeof data.isAvailable === "string"
							? data.isAvailable === "true"
							: data.isAvailable,
					adminId: data.adminId as number,
				},
			});

			// Obtener todas las ubicaciones y vincularlas automáticamente al nuevo servicio
			const allLocations = await prisma.washLocation.findMany();
			const locationServicesData = allLocations.map((location) => ({
				washLocationId: location.id,
				washServiceId: service.id,
				isAvailable: true,
			}));

			// Crear todas las relaciones en una sola operación de inserción
			await prisma.locationService.createMany({
				data: locationServicesData,
			});

			return service;
		});

		// Recuperamos el servicio con todas sus ubicaciones asociadas
		const washServiceWithLocations = await this.findById(createdService.id);
		if (!washServiceWithLocations) {
			throw new AppError(
				"Failed to create wash service with linked locations",
				500,
			);
		}

		return washServiceWithLocations;
	}

	async update(
		serviceId: number,
		data: UpdateWashServiceDTO,
		adminId: number,
	): Promise<WashService> {
		const existingService = await prisma.washService.findUnique({
			where: { id: serviceId },
		});

		if (!existingService) {
			throw new AppError("Wash service not found", 404);
		}

		const updatedService = await prisma.washService.update({
			where: { id: serviceId },
			data: {
				...data,
				adminId, // Aquí aplicamos `adminId` directamente en la actualización
			},
		});

		const serviceWithLocations = await this.findById(updatedService.id);
		if (!serviceWithLocations) {
			throw new AppError("Failed to update wash service", 500);
		}

		return serviceWithLocations;
	}

	async findManyByIds(ids: number[]): Promise<WashService[]> {
		const services = await prisma.washService.findMany({
			where: {
				id: {
					in: ids,
				},
			},
		});

		return services.map((service) => this.mapWashService(service));
	}

	async delete(serviceId: number): Promise<void> {
		const existingService = await prisma.washService.findUnique({
			where: { id: serviceId },
		});
		if (!existingService) {
			throw new AppError("Wash service not found", 404);
		}

		await prisma.washService.delete({
			where: { id: serviceId },
		});
	}

	async findAllWithLocations(
		page: number,
		pageSize: number,
		isPublished?: boolean,
		showPurchasedCount?: boolean,
		userId?: number,
	): Promise<{ services: WashService[]; total: number }> {
		const skip = (page - 1) * pageSize;

		// Obtener los servicios con paginación
		const washServicesData = await prisma.washService.findMany({
			skip,
			take: pageSize,
			where: {
				isPublished: typeof isPublished === "boolean" ? isPublished : undefined,
			},
			include: {
				locations: {
					include: {
						washLocation: true,
					},
				},
				individualServicePurchases: !showPurchasedCount
					? false
					: {
							where: {
								userId,
								status: "PENDING",
								payment: {
									status: "PAID",
								},
							},
						},
			},
		});

		// Contar el total de servicios sin paginación
		const total = await prisma.washService.count({
			where: {
				isAvailable: typeof isPublished === "boolean" ? isPublished : undefined,
			},
		});

		const services = washServicesData.map((service) =>
			this.mapWashService(service),
		);
		return { services, total };
	}

	async findTopSoldServices(filters: ListTopSoldServicesDTO): Promise<{
		individualServicePurchase: IndividualServicePurchase[];
		total: number;
	}> {
		const { page, pageSize, search, orderBy, order } = filters;
		const skip = (page - 1) * pageSize;

		console.log({ page, skip, pageSize, search });

		const where: Prisma.IndividualServicePurchaseWhereInput | undefined =
			!search
				? undefined
				: {
						OR: [
							{
								washService: {
									name: { contains: search, mode: "insensitive" },
									price: {
										equals: Number.isNaN(Number(search))
											? undefined
											: Number(search),
									},
								},
							},
							{ user: { name: { contains: search, mode: "insensitive" } } },
						],
					};

		const orderByInput: Prisma.IndividualServicePurchaseOrderByWithRelationInput =
			{};
		if (orderBy === "price") {
			orderByInput.payment = { amount: order };
		}
		if (orderBy === "createdAt") {
			orderByInput.createdAt = order;
		}
		if (orderBy === "name") {
			orderByInput.washService = { name: order };
		}

		const individualServicePurchase =
			await prisma.individualServicePurchase.findMany({
				where,
				skip,
				take: pageSize,
				include: {
					washService: true,
					payment: true,
					user: true,
				},
				orderBy: orderByInput,
			});

		const total = await prisma.individualServicePurchase.count({ where });

		return {
			individualServicePurchase: individualServicePurchase.map((purchase) =>
				this.mapIndividualServicePurchase(purchase),
			),
			total,
		};
	}

	private mapWashService(service: MappingService): WashService {
		return new WashService(
			service.id,
			service.name,
			service.price,
			service.imageUrl ?? "",
			service.isAvailable,
			service.isPublished,
			service.adminId,
			service.locations?.map(
				(location) =>
					new WashLocation(
						location.washLocation.id,
						location.washLocation.name,
						location.washLocation.managerId,
						location.washLocation.images,
						location.washLocation.street,
						location.washLocation.number,
						location.washLocation.neighborhood,
						location.washLocation.city,
						location.washLocation.flow,
						location.washLocation.phoneNumber,
						location.washLocation.isActive,
					),
			),
			service.individualServicePurchases?.map(
				(purchase) =>
					new IndividualServicePurchase(
						purchase.id,
						purchase.userId,
						purchase.washServiceId,
						purchase.purchaseDate,
						purchase.status,
						purchase.createdAt,
						purchase.updatedAt,
						purchase.paymentId,
					),
			),
		);
	}

	private mapIndividualServicePurchase(
		purchase: MappingIndividualServicePurchase,
	): IndividualServicePurchase {
		return new IndividualServicePurchase(
			purchase.id,
			purchase.userId,
			purchase.washServiceId,
			purchase.purchaseDate,
			purchase.status,
			purchase.createdAt,
			purchase.updatedAt,
			purchase.paymentId,
			!purchase.washService
				? undefined
				: new WashService(
						purchase.washService.id,
						purchase.washService.name,
						purchase.washService.price,
						purchase.washService.imageUrl,
						purchase.washService.isAvailable,
						purchase.washService.isPublished,
						purchase.washService.adminId,
					),
			!purchase.payment ? undefined : new Payment(purchase.payment),
			!purchase.user
				? undefined
				: new User({
						id: purchase.user.id,
						name: purchase.user.name,
						email: purchase.user.email,
						password: purchase.user.password,
						phone: purchase.user.phone,
						cpf: purchase.user.cpf,
						role: purchase.user.role,
						status: purchase.user.status,
					}),
		);
	}
}
