import { z } from "zod";

export const createErrorLogDto = z.object({
	message: z.string(),
	requestId: z.number(),
	stack: z.string().optional(),
	data: z.any().optional(),
});

export type CreateErrorLogDto = z.infer<typeof createErrorLogDto>;
