import { z } from "zod";

export const UpdateUserProfileDTO = z.object({
	name: z.string().optional(),
	email: z.string().email("Invalid email address").optional(),
	phone: z.string().optional(),
	cpf: z.string().optional(),
	profileImageUrl: z.string().url("Invalid URL").optional(), // Nuevo campo para la URL de la imagen
});

export type UpdateUserProfileDTO = z.infer<typeof UpdateUserProfileDTO>;
