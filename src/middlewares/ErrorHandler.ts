import type { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { AppError } from "../error/AppError";

export const errorHandler = (
	err: Error,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void => {
	console.error(new Date().toISOString(), err);
	if (err instanceof AppError) {
		res.status(err.statusCode).customJson({ message: err.message });
		return;
	}
	if (err instanceof JsonWebTokenError) {
		res.status(401).customJson({ message: "Token inválido" });
		return;
	}
	if (err instanceof TokenExpiredError) {
		res.status(401).customJson({ message: "Token expirado" });
		return;
	}
	if (err.message.includes("prisma")) {
		res.status(500).customJson({ message: "Transaction error" });
		return;
	}
	res.status(500).customJson({ message: "Erro interno do servidor" });
};
