import { z } from "zod";

export const UpdateUserPasswordDTO = z.object({
	currentPassword: z.string({ required_error: "A senha atual é obrigatória" }),
	password: z
		.string({ required_error: "A nova senha é obrigatória" })
		.min(6, "A senha deve ter no mínimo 6 caracteres"),
});

export type UpdateUserPasswordDTO = z.infer<typeof UpdateUserPasswordDTO>;
