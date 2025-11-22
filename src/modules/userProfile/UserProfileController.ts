import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import type { UpdateUserPasswordDTO } from "./dto/UpdateUserPasswordDTO";
import type { UpdateUserProfileDTO } from "./dto/UpdateUserProfileDTO";
import type { UserProfileService } from "./UserProfileService";

export class UserProfileController {
	constructor(private userProfileService: UserProfileService) {}

	// Controlador para atualizar o perfil do usuário
	public async updateUserProfile(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const body = res.locals as UpdateUserProfileDTO;

		try {
			const userId = Number(req.params.id);
			if (isNaN(userId)) {
				throw new AppError("ID de usuário inválido", 400);
			}

			const updatedUser = await this.userProfileService.updateUserProfile(
				userId,
				body,
			);
			res.status(200).customJson(updatedUser);
		} catch (error) {
			next(error);
		}
	}

	// Controlador para atualizar a senha do usuário
	public async updatePassword(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const body = res.locals as UpdateUserPasswordDTO;

		try {
			const userId = Number(req.params.id);
			if (isNaN(userId)) {
				throw new AppError("ID de usuário inválido", 400);
			}

			const updatedUser = await this.userProfileService.updatePassword(
				userId,
				body,
			);
			res.status(200).customJson(updatedUser);
		} catch (error) {
			next(error);
		}
	}

	// Controlador para solicitar a redefinição de senha
	public async requestPasswordReset(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { email } = req.body;
			await this.userProfileService.requestPasswordReset(email);
			res.status(200).customJson({
				message: "E-mail para redefinição de senha enviado com sucesso",
			});
		} catch (error) {
			next(error);
		}
	}

	// Controlador para redefinir a senha do usuário
	public async resetPassword(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { email, token, newPassword } = req.body;
			await this.userProfileService.resetPassword(email, token, newPassword);
			res.status(200).customJson({ message: "Senha atualizada com sucesso" });
		} catch (error) {
			next(error);
		}
	}
}
