import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { AppError } from "../error/AppError";

export const errorHandler = (
	err: Error,
	_req: Request,
	res: Response,
	_next: NextFunction
): void => {
	// Log estruturado (Cloud Run / GCP friendly)
	console.error(new Date().toISOString(), err);

	// Erros de negócio controlados
	if (err instanceof AppError) {
		res.status(err.statusCode).json({
			message: err.message,
		});
		return;
	}

	// JWT inválido
	if (err instanceof JsonWebTokenError) {
		res.status(401).json({
			message: "Token inválido",
		});
		return;
	}

	// JWT expirado
	if (err instanceof TokenExpiredError) {
		res.status(401).json({
			message: "Token expirado",
		});
		return;
	}

	// Erros do Prisma (fallback seguro)
	if (err.message && err.message.toLowerCase().includes("prisma")) {
		res.status(500).json({
			message: "Transaction error",
		});
		return;
	}

	// Erro não tratado
	res.status(500).json({
		message: "Erro interno do servidor",
	});
};
