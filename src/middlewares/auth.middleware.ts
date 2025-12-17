import { NextFunction, Response } from "express";
import { PrismaUserRepository } from "../repositories/implementations/PrismaUserRepository";
import { AppError } from "../error/AppError";
import { verifyToken } from "../utils/token";
import { AuthenticatedRequest } from "../utils/asaas/types/AuthenticatedRequest";

export const authMiddleware = async (
	req: AuthenticatedRequest,
	_res: Response,
	next: NextFunction
): Promise<void> => {

	// 🚨 Preflight NÃO passa por auth
	if (req.method === "OPTIONS") {
		return next();
	}

	const authHeader = req.headers.authorization;
	if (!authHeader) {
		return next(new AppError("No token provided", 401));
	}

	try {
		const [, token] = authHeader.split(" ");
		const decoded = verifyToken(token);
		req.user = decoded;

		const userRepository = new PrismaUserRepository();
		const user = await userRepository.findById(decoded.id);

		if (!user) {
			throw new AppError("Você não tem permissão", 401);
		}

		if (user.status !== "ACTIVE") {
			throw new AppError(
				"Conta inativa. Entre em contato com o suporte.",
				403
			);
		}

		next();
	} catch (error) {
		next(error);
	}
};
