import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

function validateRoutePayload<T extends z.ZodTypeAny>(schema: T) {
	return (req: Request, res: Response, next: NextFunction) => {
		try {
			const parsed: z.infer<T> = schema.parse({
				...req.body,
				...req.query,
				...req.params,
			});
			res.locals = { ...res.locals, ...parsed }; // Agregar los datos parseados a res.locals
			next();
		} catch (err) {
			if (err instanceof z.ZodError) {
				// Verifica que el error es de tipo ZodError
				res.status(400).customJson({
					message: "Invalid request data",
					errors: err.errors, // Accede a los errores de Zod
				});
			} else {
				// Manejo de otros errores inesperados
				res.status(500).customJson({
					message: "Internal server error",
				});
			}
		}
	};
}

export default validateRoutePayload;
