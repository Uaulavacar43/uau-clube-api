import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { CreateWashServiceDTO } from "./dto/CreateWashServiceDTO";
import type { ListServicesWithLocationsDTO } from "./dto/ListServicesWithLocationsDTO";
import type { ListTopSoldServicesDTO } from "./dto/ListTopSoldServicesDTO";
import type { UpdateWashServiceDTO } from "./dto/UpdateWashServiceDTO";
import type { WashServiceService } from "./WashService";

export class WashServiceController {
	constructor(private washService: WashServiceService) {}

	public async createWashService(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		const body = res.locals as CreateWashServiceDTO;
		try {
			if (req.user?.role !== "ADMIN") {
				throw new AppError(
					"Apenas administradores podem criar serviços de lavagem",
					403,
				);
			}

			const data = {
				name: body.name,
				price: body.price,
				imageUrl: body.imageUrl,
				isAvailable: body.isAvailable,
				isPublished: body.isPublished,
				adminId: req.user?.id as number, // Atribui o adminId diretamente em `data`
			};

			const washService = await this.washService.create(data); // Apenas passamos `data`

			return res.status(201).customJson(washService);
		} catch (error) {
			next(error);
		}
	}

	public async updateWashService(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		try {
			if (req.user?.role !== "ADMIN") {
				throw new AppError(
					"Apenas administradores podem atualizar serviços de lavagem",
					403,
				);
			}

			const serviceId = Number(req.params.id);
			const body = res.locals as UpdateWashServiceDTO;
			const imageUrl = body.imageUrl;

			const data: UpdateWashServiceDTO = {
				name: body.name ?? undefined,
				price: body.price,
				imageUrl,
				isAvailable: body.isAvailable,
				isPublished: body.isPublished,
				adminId: req.user.id,
			};

			const washService = await this.washService.update(
				serviceId,
				data,
				data.adminId || req.user.id,
			);

			return res.status(200).customJson(washService);
		} catch (error) {
			next(error);
		}
	}

	public async deleteWashService(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		try {
			const serviceId = Number(req.params.id);
			if (req.user?.role !== "ADMIN") {
				throw new AppError(
					"Apenas administradores podem deletar serviços de lavagem",
					403,
				);
			}
			await this.washService.delete(serviceId, req.user.id);

			return res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	public async listServicesWithLocations(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		try {
			const filters = res.locals as ListServicesWithLocationsDTO;

			if (!req.user) {
				console.log(req.user);
				throw new AppError("Usuário não autenticado", 401);
			}

			const isPublished = filters.isAvailable;
			const showPurchasedCount = filters.showPurchasedCount;
			const { services, totalPages } =
				await this.washService.listServicesWithLocations(
					filters.page,
					filters.pageSize,
					["ADMIN", "MANAGER"].includes(req.user.role) ? isPublished : true,
					showPurchasedCount,
					req.user.id,
				);

			res.status(200).customJson({ services, totalPages });
		} catch (error) {
			next(error);
		}
	}

	public async listTopSoldServices(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		try {
			if (!req.user) {
				console.log(req.user);
				throw new AppError("Usuário não autenticado", 401);
			}
			const filters = res.locals as ListTopSoldServicesDTO;
			const { individualServicePurchase, totalPages } =
				await this.washService.listTopSoldServices(filters);

			res.status(200).customJson({ individualServicePurchase, totalPages });
		} catch (error) {
			next(error);
		}
	}

	public async getServiceById(req: Request, res: Response, next: NextFunction) {
		try {
			const serviceId = Number(req.params.id);
			const service = await this.washService.getServiceById(serviceId);

			res.status(200).customJson(service);
		} catch (error) {
			next(error);
		}
	}
}
