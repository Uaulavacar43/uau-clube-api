import { z } from "zod";

export const ActivateSubscriptionSchema = z.object({
	userId: z.number({ required_error: "O ID do usuário é obrigatório" }),
});

export type ActivateSubscriptionDTO = z.infer<
	typeof ActivateSubscriptionSchema
>;
