import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { DeleteUserCarDTO } from "./dto/DeleteUserCarDTO";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";
import type { UserCarService } from "./UserCarService";

export class UserCarController {
	constructor(private userCarService: UserCarService) {}

	private isPrivilegedRole(role?: string): boolean {
		return role === "ADMIN" || role === "MANAGER";
	}

	public async registerUserCar(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const data = res.locals as RegisterUserCarDTO;

		try {
			const actor = req.user;
			if (!actor || !actor.id) {
				throw new AppError("Usuário não autenticado", 401);
			}

			if (data.userId && data.userId !== actor.id) {
				if (!this.isPrivilegedRole(actor.role)) {
					throw new AppError(
						"Apenas administradores ou gerentes podem criar carros para outros usuários",
						403,
					);
				}
			}

			const result = await this.userCarService.registerCar(
				data,
				actor.id,
				{ id: actor.id, role: actor.role },
			);

			const status = result.created ? 201 : 200;
			res.status(status).customJson(result.car);
		} catch (error) {
			next(error);
		}
	}

	public async listCars(req: Request, res: Response, next: NextFunction) {
		try {
			const actor = req.user;
			if (!actor || !actor.id) {
				return res.status(401).customJson({ error: "Não autorizado" });
			}

			const cars = await this.userCarService.listCars(actor.id);
			return res.status(200).customJson(cars);
		} catch (error) {
			next(error);
		}
	}

	public async updateCar(req: Request, res: Response, next: NextFunction) {
		try {
			const actor = req.user;
			if (!actor || !actor.id) {
				return res.status(401).customJson({ error: "Não autorizado" });
			}

			const data = res.locals as UpdateUserCarDTO;

			if ((data as any).userId && (data as any).userId !== actor.id) {
				if (!this.isPrivilegedRole(actor.role)) {
					throw new AppError(
						"Apenas administradores ou gerentes podem atualizar carros de outros usuários",
						403,
					);
				}
			}

			const updatedCar = await this.userCarService.updateCar(data, {
				id: actor.id,
				role: actor.role,
			});

			return res.status(200).customJson(updatedCar);
		} catch (error) {
			next(error);
		}
	}

	public async deleteCar(req: Request, res: Response, next: NextFunction) {
		try {
			const actor = req.user;
			if (!actor || !actor.id) {
				throw new AppError("Não autorizado", 401);
			}

			const data = res.locals as DeleteUserCarDTO;

			await this.userCarService.deleteCar(data.id, {
				id: actor.id,
				role: actor.role,
			});

			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	public async listUserCars(req: Request, res: Response, next: NextFunction) {
		try {
			const actor = req.user;
			if (!actor || !actor.id) {
				throw new AppError("Não autorizado", 401);
			}

			const userId = Number(req.params.userId);
			if (!Number.isFinite(userId) || userId <= 0) {
				throw new AppError("Parâmetro userId inválido", 400);
			}

			if (!this.isPrivilegedRole(actor.role) && actor.id !== userId) {
				throw new AppError(
					"Você não está autorizado a listar veículos de outro usuário",
					403,
				);
			}

			const cars = await this.userCarService.listCars(userId);
			return res.status(200).customJson(cars);
		} catch (error) {
			next(error);
		}
	}
}
