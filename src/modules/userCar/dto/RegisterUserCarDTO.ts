import { z } from "zod";

export const RegisterUserCarDTO = z.object({
	licensePlate: z
		.string({
			required_error: "Placa é obrigatória",
			invalid_type_error: "Placa deve ser uma string",
		})
		.min(7, "Placa deve ter no mínimo 7 caracteres")
		.trim()
		.transform((value) => value.toUpperCase()),

	color: z.string({
		required_error: "Cor é obrigatória",
		invalid_type_error: "Cor deve ser uma string",
	}),

	model: z.string({
		required_error: "Modelo é obrigatório",
		invalid_type_error: "Modelo deve ser uma string",
	}),

	brand: z.string({
		required_error: "Marca é obrigatória",
		invalid_type_error: "Marca deve ser uma string",
	}),

	year: z.coerce
		.number({
			required_error: "Ano é obrigatório",
			invalid_type_error: "Ano deve ser um número",
		})
		.min(1900, "Ano inválido")
		.max(new Date().getFullYear() + 1, "Ano inválido"),

	// Optional userId field for admin use
	userId: z.coerce.number({
		invalid_type_error: "ID do usuário deve ser um número",
	}).optional(),
});

export type RegisterUserCarDTO = z.infer<typeof RegisterUserCarDTO>;
