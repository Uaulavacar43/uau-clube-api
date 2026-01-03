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
			const userId = Number((req as any).user?.id);

			// 1) tenta env
			let baseUrl = (process.env.APP_BASE_URL ?? '').trim();

			// 2) fallback: tenta montar pela request (bom quando APP_BASE_URL não tá setada)
			if (!baseUrl) {
				const xfProto = (req.get('x-forwarded-proto') ?? '').split(',')[0].trim();
				const xfHost = (req.get('x-forwarded-host') ?? '').split(',')[0].trim();
				const host = xfHost || req.get('host') || '';

				const proto = xfProto || (req.protocol || 'https');

				if (host) {
					baseUrl = `${proto}://${host}`;
				}
			}

			const result = await this.authService.getReferralLink(userId, baseUrl);

			res.status(200).customJson(result);
		} catch (error) {
			next(error);
		}
	}

}
