import { z } from "zod";

export const createRequestLogDto = z.object({
	userId: z.number().optional(),
	requestId: z.string(),
	method: z.string(),
	path: z.string(),
	query: z.any().optional(),
	body: z.any().optional(),
	params: z.any().optional(),
	ip: z.string().ip().optional(),
	userAgent: z.string().optional(),
});

export type CreateRequestLogDto = z.infer<typeof createRequestLogDto>;
