import { z } from "zod";

export const UpdateIndividualServicePurchaseDTO = z.object({
	id: z.coerce
		.number({
			required_error: "ID da compra é obrigatório",
			invalid_type_error: "ID da compra deve ser um número",
		})
		.int()
		.positive("ID da compra deve ser um número positivo"),
	status: z.enum(["PENDING", "COMPLETED", "CANCELED"], {
		required_error: "Status da compra é obrigatório",
		invalid_type_error: "Status da compra deve ser um enum",
	}),
});

export type UpdateIndividualServicePurchaseDTO = z.infer<
	typeof UpdateIndividualServicePurchaseDTO
>;
