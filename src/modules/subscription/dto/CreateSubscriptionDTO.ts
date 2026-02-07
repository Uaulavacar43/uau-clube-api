import { z } from "zod";

export const CreateSubscriptionSchema = z.object({
	userId: z.coerce.number({
		required_error: "ID do usuário é obrigatório",
	}),
	planId: z.coerce.number({
		required_error: "ID do plano é obrigatório",
	}),
	carId: z.coerce.number().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

export type CreateSubscriptionDTO = z.infer<typeof CreateSubscriptionSchema>;

