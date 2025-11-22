import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { CreateUserDTO } from "./dto/CreateUserDTO";
import type { DeleteUserDTO } from "./dto/DeleteUserDTO";
import type { GetAllUsersDTO } from "./dto/GetAllUsersDTO";
import type { UpdateIndividualServicePurchaseDTO } from "./dto/UpdateIndividualServicePurchaseDTO";
import type { UpdateUserDTO } from "./dto/UpdateUserDTO";
import type { UserService } from "./UserAdminService";

export class UserAdminController {
	constructor(private userService: UserService) {}

	public async createUser(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data: CreateUserDTO = res.locals as CreateUserDTO;
			const user = await this.userService.createUser(data);
			res.status(201).customJson(user);
		} catch (error) {
			next(error);
		}
	}

	public async updateUser(
		_req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data: UpdateUserDTO = res.locals as UpdateUserDTO;

			const user = await this.userService.updateUser(data);
			res.status(200).customJson(user);
		} catch (error) {
			next(error);
		}
	}

	public async deleteUser(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as DeleteUserDTO;
			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Você não tem permissão para isto", 403);
			}
			if (loggedUser.role !== "ADMIN" && loggedUser.id !== data.id) {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			await this.userService.deleteUser(data.id);
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	public async updateIndividualServicePurchase(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as UpdateIndividualServicePurchaseDTO;
			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Você não tem permissão para isto", 403);
			}
			if (!["ADMIN", "MANAGER"].includes(loggedUser.role)) {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			const individualServicePurchase =
				await this.userService.updateIndividualServicePurchase(
					data.id,
					data.status,
				);
			res.status(200).customJson(individualServicePurchase);
		} catch (error) {
			next(error);
		}
	}

	public async getUserByLicensePlate(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const licensePlate = req.params.licensePlate;
			if (!licensePlate) {
				throw new AppError("Placa de veiculo inválida", 400);
			}

			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Você não tem permissão para isto", 403);
			}
			if (!["ADMIN", "MANAGER"].includes(loggedUser.role)) {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			const user = await this.userService.getUserByLicensePlate(licensePlate);
			res.status(200).customJson(user);
		} catch (error) {
			next(error);
		}
	}

	public async getUserById(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const userId = Number(req.params.id);
			if (isNaN(userId)) {
				throw new AppError("ID de usuário inválido", 400);
			}

			const loggedUser = req.user;
			if (!loggedUser) {
				throw new AppError("Você não tem permissão para isto", 403);
			}
			if (loggedUser.role !== "ADMIN" && loggedUser.id !== userId) {
				throw new AppError("Você não tem permissão para isto", 403);
			}

			const user = await this.userService.getUserById(userId);
			res.status(200).customJson(user);
		} catch (error) {
			next(error);
		}
	}

	public async getUsersByRole(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { role } = req.params;
			const page = parseInt(req.query.page as string) || 1;
			const pageSize = parseInt(req.query.pageSize as string) || 10;

			if (!["ADMIN", "USER", "MANAGER"].includes(role)) {
				throw new AppError("Papel inválido", 400);
			}

			const { users, total } = await this.userService.getUsersByRole(
				role as "ADMIN" | "USER" | "MANAGER",
				page,
				pageSize,
			);
			res.status(200).customJson({ users, total, page, pageSize });
		} catch (error) {
			next(error);
		}
	}

	public async getUsersAndSubscribersCount(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const counts = await this.userService.getUsersAndSubscribersCount();
			res.status(200).customJson(counts);
		} catch (error) {
			next(error);
		}
	}

	public async countAllUsers(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const totalUsers = await this.userService.countAllUsers();
			res.status(200).customJson({ totalUsers });
		} catch (error) {
			next(error);
		}
	}

	// Método para obter a contagem de assinantes ativos
	public async countActiveSubscribers(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const activeSubscribers = await this.userService.countActiveSubscribers();
			res.status(200).customJson({ activeSubscribers });
		} catch (error) {
			next(error);
		}
	}

	public async getAllUsers(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const filters = res.locals as GetAllUsersDTO;
			const page = filters.page || 1; // Página padrão é 1
			const pageSize = filters.pageSize || 10; // Tamanho padrão da página é 10

			const { users, total } = await this.userService.getAllUsers(filters);

			res.status(200).customJson({
				users,
				total,
				currentPage: page,
				totalPages: Math.ceil(total / pageSize),
			});
		} catch (error) {
			next(error);
		}
	}
}
