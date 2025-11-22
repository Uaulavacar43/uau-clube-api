import { z } from "zod";

export const createResponseLogDto = z.object({
	requestId: z.string(),
	status: z.string(),
	data: z.any().optional(),
	ip: z.string().ip().optional(),
	userAgent: z.string().optional(),
});

export type CreateResponseLogDto = z.infer<typeof createResponseLogDto>;
