import type { NextFunction, Request, Response } from "express";
import type { AuthService } from "./AuthService";
import type { LoginUserDTO } from "./dto/LoginUserDTO";
import type { RegisterUserDTO } from "./dto/RegisterUserDTO";

export class AuthController {
	constructor(private authService: AuthService) {
	}

	/**
	 * POST /auth/register
	 */
	public async register(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as RegisterUserDTO;

			const result = await this.authService.register(data);

			res.status(201).customJson({
				token: result.token,
				refreshToken: result.refreshToken,
				user: result.user,
				referralLink: result.referralLink,
			});
		} catch (error) {
			next(error);
		}
	}

	/**
	 * POST /auth/login
	 */
	public async login(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const data = res.locals as LoginUserDTO;
			const result = await this.authService.login(data);

			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}

	/**
	 * POST /auth/refresh-token
	 */
	public async refreshToken(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const {refreshToken} = req.body;
			const result = await this.authService.refreshToken(refreshToken);

			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}

	/**
	 * GET /auth/referral-link
	 * 🔗 Retorna o link de indicação do usuário logado
	 */
	public async getReferralLink(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const userIdRaw = (req as any).user?.id;
			const userId = Number(userIdRaw);

			if (!userIdRaw || Number.isNaN(userId) || userId <= 0) {
				// 401 é o correto se não tem user no request
				res.status(401).customJson({message: "Unauthorized"});
				return;
			}

			const result = await this.authService.getReferralLink(userId);

			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}
}
