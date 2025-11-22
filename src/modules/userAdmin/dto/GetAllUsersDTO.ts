import { z } from "zod";

export const GetAllUsersDTO = z.object({
	page: z.coerce
		.number({
			required_error: "Página é obrigatória",
			invalid_type_error: "Página deve ser um número",
		})
		.int()
		.positive("Página deve ser um número positivo"),

	pageSize: z.coerce
		.number({
			required_error: "Tamanho da página é obrigatório",
			invalid_type_error: "Tamanho da página deve ser um número",
		})
		.int()
		.positive("Tamanho da página deve ser um número positivo"),

	roles: z.array(z.enum(["USER", "ADMIN", "MANAGER"])).optional(),

	searchTerm: z.string().optional(),

	orderBy: z
		.enum(["name", "email", "createdAt", "updatedAt", "lastPaymentDate"])
		.optional(),
	orderDirection: z.enum(["asc", "desc"]).optional(),
	includePlans: z.coerce.boolean().optional().default(false),
});

export type GetAllUsersDTO = z.infer<typeof GetAllUsersDTO>;
