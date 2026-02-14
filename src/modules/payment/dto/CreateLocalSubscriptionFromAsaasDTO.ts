import { z } from "zod";

export const CreateLocalSubscriptionFromAsaasSchema = z.object({
	userId: z.number({ required_error: "O ID do usuário é obrigatório" }),
	planId: z.number({ required_error: "O ID do plano é obrigatório" }),
	carId: z.number({ required_error: "O ID do carro é obrigatório" }),
	asaasSubscriptionId: z.string({
		required_error: "O ID da assinatura do Asaas é obrigatório",
	}),
});

export type CreateLocalSubscriptionFromAsaasDTO = z.infer<
	typeof CreateLocalSubscriptionFromAsaasSchema
>;
