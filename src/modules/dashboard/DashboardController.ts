import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { DashboardService } from "./DashboardService";

export class DashboardController {
	constructor(private dashboardService: DashboardService) {}

	async getDashboardData(req: Request, res: Response, next: NextFunction) {
		try {
			if (!req.user) {
				throw new AppError("Voce nao tem permissão", 401);
			}

			if (req.user.role !== "ADMIN") {
				throw new AppError("Voce nao tem permissão", 403);
			}

			const dashboardData = await this.dashboardService.getDashboardData();

			res.customJson(dashboardData);
		} catch (error) {
			next(error);
		}
	}
}
