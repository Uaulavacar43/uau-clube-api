import type { NextFunction, Request, Response } from "express";
import type { AuthService } from "./AuthService";
import type { LoginUserDTO } from "./dto/LoginUserDTO";
import type { RegisterUserDTO } from "./dto/RegisterUserDTO";

export class AuthController {
	constructor(private authService: AuthService) {}

	public async register(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as RegisterUserDTO;
			const result = await this.authService.register(data); // Result incluye token, refreshToken y user
			res.status(201).customJson(result); // Retorna token, refreshToken y user
		} catch (error) {
			next(error);
		}
	}

	public async login(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as LoginUserDTO;
			const result = await this.authService.login(data); // Result incluye token, refreshToken y user
			res.status(200).customJson(result); // Retorna token, refreshToken y user
		} catch (error) {
			next(error);
		}
	}

	public async getFirebaseToken(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { id } = req.params;
			const token = await this.authService.getFirebaseTokens(Number(id));
			res.status(200).customJson({ firebaseToken: token });
		} catch (error) {
			next(error);
		}
	}

	public async refreshToken(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const { refreshToken } = req.body;
			const result = await this.authService.refreshToken(refreshToken);
			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}
}
