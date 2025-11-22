import { z } from "zod";

export const UpdateUserCarDTO = z.object({
	id: z.coerce
		.number({
			required_error: "ID do carro é obrigatório",
			invalid_type_error: "ID do carro deve ser um número",
		})
		.int()
		.positive("ID do carro deve ser um número positivo"),

	licensePlate: z
		.string({
			invalid_type_error: "Placa deve ser uma string",
		})
		.min(7, "Placa deve ter no mínimo 7 caracteres")
		.trim()
		.transform((value) => value.toUpperCase())
		.optional(),

	color: z
		.string({
			invalid_type_error: "Cor deve ser uma string",
		})
		.optional(),

	model: z
		.string({
			invalid_type_error: "Modelo deve ser uma string",
		})
		.optional(),

	brand: z
		.string({
			invalid_type_error: "Marca deve ser uma string",
		})
		.optional(),

	year: z.coerce
		.number({
			invalid_type_error: "Ano deve ser um número",
		})
		.min(1900, "Ano inválido")
		.max(new Date().getFullYear() + 1, "Ano inválido")
		.optional(),

	// Optional userId field for admin use
	userId: z.coerce
		.number({
			invalid_type_error: "ID do usuário deve ser um número",
		})
		.optional(),
});

export type UpdateUserCarDTO = z.infer<typeof UpdateUserCarDTO>;
