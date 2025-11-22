import type { NextFunction, Request, Response } from "express";
import { AppError } from "../error/AppError";

interface AuthenticatedRequest extends Request {
	user?: any;
}

export const accessControlMiddleware = (allowedRoles: string[]) => {
	return (
		req: AuthenticatedRequest,
		res: Response,
		next: NextFunction,
	): void => {
		if (!req.user || !allowedRoles.includes(req.user.role)) {
			throw new AppError("Access denied", 403);
		}
		next();
	};
};
