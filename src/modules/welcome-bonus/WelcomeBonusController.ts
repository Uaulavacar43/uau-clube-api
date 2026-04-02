import type { NextFunction, Request, Response } from "express";
import type { WelcomeBonusService } from "./WelcomeBonusService";

export class WelcomeBonusController {
	constructor(private welcomeBonusService: WelcomeBonusService) {}

	async getBonus(req: Request, res: Response, next: NextFunction): Promise<void> {
		try {
			const userId = (req as any).userId as number;
			const bonus = await this.welcomeBonusService.getBonusForUser(userId);

			if (!bonus) {
				res.status(404).json({ message: "Usuário não encontrado" });
				return;
			}

			res.status(200).json(bonus);
		} catch (error) {
			next(error);
		}
	}
}
