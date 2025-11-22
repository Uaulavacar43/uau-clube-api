import { z } from "zod";

export const DeleteUserCarDTO = z.object({
	id: z.coerce
		.number({
			required_error: "ID do carro é obrigatório",
			invalid_type_error: "ID do carro deve ser um número",
		})
		.int()
		.positive("ID do carro deve ser um número positivo"),
});

export type DeleteUserCarDTO = z.infer<typeof DeleteUserCarDTO>;
