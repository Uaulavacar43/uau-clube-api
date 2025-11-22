import { z } from "zod";

export const DeleteUserDTO = z.object({
	id: z.coerce
		.number({
			required_error: "ID do usuário é obrigatório",
			invalid_type_error: "ID do usuário deve ser um número",
		})
		.int()
		.positive("ID do usuário deve ser um número positivo"),
});

export type DeleteUserDTO = z.infer<typeof DeleteUserDTO>;
