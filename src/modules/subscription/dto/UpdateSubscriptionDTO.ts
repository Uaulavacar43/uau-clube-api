import { z } from "zod";

export const UpdateSubscriptionSchema = z.object({
	id: z.coerce.number({
		required_error: "ID de assinatura é obrigatório",
	}),
	// plan: z.enum(["MONTHLY", "ANNUAL"]).optional(),
	carId: z.number({
		required_error: "ID do veículo é obrigatório",
	}),
});

export type UpdateSubscriptionDTO = z.infer<typeof UpdateSubscriptionSchema>;
