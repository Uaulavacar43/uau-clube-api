import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { DeleteUserCarDTO } from "./dto/DeleteUserCarDTO";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";
import type { UserCarService } from "./UserCarService";

export class UserCarController {
	constructor(private userCarService: UserCarService) {}

	public async registerUserCar(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const data = res.locals as RegisterUserCarDTO;

		try {
			const authenticatedUserId = req.user?.id;
			if (!authenticatedUserId) {
				throw new AppError("Usuário não autenticado", 401);
			}

			let targetUserId = authenticatedUserId;

			// Admin pode cadastrar carro para outro usuário
			if (data.userId && data.userId !== authenticatedUserId) {
				if (req.user?.role !== "ADMIN") {
					throw new AppError(
						"Apenas administradores podem criar carros para outros usuários",
						403,
					);
				}
				targetUserId = data.userId;
			}

			const car = await this.userCarService.registerCar(data, targetUserId);
			res.status(201).customJson(car);
		} catch (error) {
			next(error);
		}
	}

	public async listCars(req: Request, res: Response, next: NextFunction) {
		try {
			if (!req.user) {
				return res.status(401).customJson({ error: "Não autorizado" });
			}

			const cars = await this.userCarService.listCars(req.user.id);
			return res.status(200).customJson(cars);
		} catch (error) {
			next(error);
		}
	}

	public async updateCar(req: Request, res: Response, next: NextFunction) {
		try {
			const data = res.locals as UpdateUserCarDTO;

			if (!req.user) {
				return res.status(401).customJson({ error: "Não autorizado" });
			}

			let targetUserId = req.user.id;

			// Admin pode editar carro de outro user (se seu DTO permitir userId)
			if (data.userId && data.userId !== req.user.id) {
				if (req.user?.role !== "ADMIN") {
					throw new AppError(
						"Apenas administradores podem atualizar carros de outros usuários",
						403,
					);
				}
				targetUserId = data.userId;
			}

			const updatedCar = await this.userCarService.updateCar(data, {
				id: targetUserId,
				role: req.user.role,
			});

			return res.status(200).customJson(updatedCar);
		} catch (error) {
			next(error);
		}
	}

	public async deleteCar(req: Request, res: Response, next: NextFunction) {
		try {
			const data = res.locals as DeleteUserCarDTO;

			if (!req.user) {
				throw new AppError("Não autorizado", 401);
			}

			await this.userCarService.deleteCar(data.id, req.user);
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	public async listUserCars(req: Request, res: Response, next: NextFunction) {
		try {
			const userId = Number(req.params.userId);
			const cars = await this.userCarService.listCars(userId);
			return res.status(200).customJson(cars);
		} catch (error) {
			next(error);
		}
	}
}
