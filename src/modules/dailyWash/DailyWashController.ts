// src/modules/dailyWash/DailyWashController.ts
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { DailyWashService } from "./DailyWashService";
import type { CheckDailyWashAvailabilityDTO } from "./dto/CheckDailyWashAvailabilityDTO";
import type { RegisterDailyWashDTO } from "./dto/RegisterDailyWashDTO";

export class DailyWashController {
	constructor(private readonly dailyWashService: DailyWashService) {}

	public async useDailyWash(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as RegisterDailyWashDTO;

			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Usuário não autenticado", 401);
			}

			if (!data.licensePlate) {
				throw new AppError("A placa do veículo é obrigatória", 400);
			}

			// ✅ agora passa o userId (regra nova: placa não é global)
			const dailyWash = await this.dailyWashService.useDailyWash(data, loggedUser.id);

			res.customJson(dailyWash);
		} catch (error) {
			next(error);
		}
	}

	public async checkAvailability(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as CheckDailyWashAvailabilityDTO;

			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Usuário não autenticado", 401);
			}

			const total = await this.dailyWashService.checkDailyWashAvailability(
				loggedUser.id,
				data.timeZoneOffset,
			);

			res.customJson({ total });
		} catch (error) {
			next(error);
		}
	}

	public async getUserWashHistory(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const userId = parseInt(req.params.userId, 10);
			const page = parseInt((req.query.page as string) || "1", 10);
			const pageSize = parseInt((req.query.pageSize as string) || "10", 10);

			if (Number.isNaN(userId)) {
				throw new AppError("ID do usuário inválido", 400);
			}

			const result = await this.dailyWashService.getUserWashHistory(
				userId,
				page,
				pageSize,
			);

			res.customJson(result);
		} catch (error) {
			next(error);
		}
	}
}
