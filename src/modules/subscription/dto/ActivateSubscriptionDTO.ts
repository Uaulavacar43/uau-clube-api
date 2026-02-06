import { z } from "zod";

export const ActivateSubscriptionSchema = z.object({
	id: z.coerce.number({
		required_error: "ID de assinatura é obrigatório",
	}),
	planId: z.coerce.number().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

export type ActivateSubscriptionDTO = z.infer<typeof ActivateSubscriptionSchema>;
