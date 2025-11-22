import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { FavoriteWashLocationDTO } from "./dto/FavoriteWashLocationDTO";
import type { GetAllWashLocationsDTO } from "./dto/GetAllWashLocationsDTO";
import type { RegisterCompleteWashLocationDTO } from "./dto/RegisterCompleteWashLocationDTO";
import type { RegisterWashLocationDTO } from "./dto/RegisterWashLocationDTO";
import type { UpdateCompleteWashLocationDTO } from "./dto/UpdateCompleteWashLocationDTO";
import { UpdateOpeningHoursDTO } from "./dto/UpdateOpeningHoursDTO";
import type { UpdateWashLocationDTO } from "./dto/UpdateWashLocationDTO";
import type { WashLocationService } from "./WashLocationService";

export class WashLocationController {
	constructor(private washLocationService: WashLocationService) {}

	public async registerWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data: RegisterWashLocationDTO = req.body;

			// Validação adicional para garantir que todos os campos estão presentes
			if (
				!data.name ||
				!data.images ||
				!data.street ||
				!data.number ||
				!data.neighborhood ||
				!data.city ||
				!data.managerId
			) {
				throw new AppError(
					"Todos os campos são obrigatórios para criar um local de lavagem",
					400,
				);
			}

			const washLocation =
				await this.washLocationService.registerWashLocation(data);
			res.status(201).customJson(washLocation);
		} catch (error) {
			next(error);
		}
	}

	public async listWashLocations(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const loggedUser = req.user;
			const data = res.locals as GetAllWashLocationsDTO;

			const washLocations = await this.washLocationService.listWashLocations(
				data,
				loggedUser?.id,
			);
			res.status(200).customJson(washLocations);
		} catch (error) {
			next(error);
		}
	}

	public async updateServiceAvailability(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId, serviceId } = req.params;
			const { isAvailable } = req.body;

			const updatedLocation =
				await this.washLocationService.updateServiceAvailability(
					Number(locationId),
					Number(serviceId),
					isAvailable,
				);
			res.status(200).customJson(updatedLocation);
		} catch (error) {
			next(error);
		}
	}

	public async updateFlow(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId } = req.params;
			const { flow } = req.body;

			const updatedLocation = await this.washLocationService.updateFlow(
				Number(locationId),
				flow,
			);
			res.status(200).customJson(updatedLocation);
		} catch (error) {
			next(error);
		}
	}

	public async updateOpeningHours(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId } = req.params;
			const openingHours = req.body.openingHours;

			// Verificar se openingHours é um array
			if (!Array.isArray(openingHours)) {
				throw new AppError(
					"Dados inválidos: openingHours deve ser um array",
					400,
				);
			}

			// Verificar se cada item do array tem o formato correto
			for (const hour of openingHours) {
				if (!hour.dayOfWeek || !hour.openTime || !hour.closeTime) {
					throw new AppError(
						"Cada horário deve conter dayOfWeek, openTime e closeTime",
						400,
					);
				}
			}

			const updatedLocation = await this.washLocationService.updateOpeningHours(
				Number(locationId),
				openingHours,
			);
			res.status(200).customJson(updatedLocation);
		} catch (error) {
			next(error);
		}
	}

	public async listWashLocationsByManager(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { managerId } = req.params;
			const locations =
				await this.washLocationService.listWashLocationsByManagerId(
					Number(managerId),
				);
			res.status(200).customJson(locations);
		} catch (error) {
			next(error);
		}
	}

	public async getWashLocationDetail(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const user = req.user;
			if (!user) {
				throw new AppError("Usuário não autenticado", 401);
			}

			const { locationId } = req.params;
			const location = await this.washLocationService.getWashLocationById(
				Number(locationId),
				user.role === "USER" ? user.id : undefined,
			);

			if (!location) {
				throw new AppError("Local de lavagem não encontrado", 404);
			}

			res.status(200).customJson(location);
		} catch (error) {
			next(error);
		}
	}

	public async updateWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId } = req.params;
			const data: UpdateWashLocationDTO = req.body;

			const updatedLocation = await this.washLocationService.updateWashLocation(
				Number(locationId),
				data,
			);
			res.status(200).customJson(updatedLocation);
		} catch (error) {
			next(error);
		}
	}

	public async registerCompleteWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data: RegisterCompleteWashLocationDTO = req.body;

			// Validação básica
			if (
				!data.name ||
				!data.images ||
				!data.street ||
				!data.number ||
				!data.neighborhood ||
				!data.city ||
				!data.managerId
			) {
				throw new AppError(
					"Todos os campos básicos são obrigatórios para criar um local de lavagem",
					400,
				);
			}

			const washLocation =
				await this.washLocationService.registerCompleteWashLocation(data);
			res.status(201).customJson(washLocation);
		} catch (error) {
			next(error);
		}
	}

	public async updateCompleteWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId } = req.params;
			const data = res.locals as UpdateCompleteWashLocationDTO;

			// Validação básica - verificar se pelo menos um campo foi fornecido
			if (Object.keys(data).length === 0) {
				throw new AppError("Nenhum campo fornecido para atualização", 400);
			}

			const updatedLocation =
				await this.washLocationService.updateCompleteWashLocation(
					Number(locationId),
					data,
				);
			res.status(200).customJson(updatedLocation);
		} catch (error) {
			next(error);
		}
	}

	public async favoriteWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const user = req.user;
			if (!user) {
				throw new AppError("Usuário não autenticado", 401);
			}
			const data = res.locals as FavoriteWashLocationDTO;

			const isFavorited = await this.washLocationService.favoriteWashLocation(
				user.id,
				data.locationId,
			);

			res.status(200).customJson({ isFavorited });
		} catch (error) {
			next(error);
		}
	}

	public async deleteWashLocation(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { locationId } = req.params;
			await this.washLocationService.deleteWashLocation(Number(locationId));
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}
}
