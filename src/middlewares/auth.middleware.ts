import type { NextFunction, Request, Response } from "express";
import { AppError } from "../error/AppError";
import { PrismaUserRepository } from "../repositories/implementations/PrismaUserRepository";
import { verifyToken } from "../utils/token";

interface AuthenticatedRequest extends Request {
	user?: any;
}

export const authMiddleware = async (
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	const authHeader = req.headers.authorization;
	if (!authHeader) {
		throw new AppError("No token provided", 401);
	}

	const [, token] = authHeader.split(" ");
	try {
		const decoded = verifyToken(token);
		req.user = decoded;

		const userRepository = new PrismaUserRepository();
		const user = await userRepository.findById(decoded.id);
		if (!user) {
			throw new AppError("Voce nao tem permissão", 401);
		}

		if (user.status !== "ACTIVE") {
			throw new AppError("Conta inativa. Entre em contato com o suporte.", 403);
		}

		next();
	} catch (error) {
		next(error);
	}
};
