import { z } from "zod";

export const createWebhookLogDto = z.object({
	userId: z.number().optional(),
	paymentId: z.number().optional(),
	payload: z.record(z.string(), z.any()).optional(),
	error: z.record(z.string(), z.any()).optional(),
});

export type CreateWebhookLogDto = z.infer<typeof createWebhookLogDto>;
