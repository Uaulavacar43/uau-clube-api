import { z } from "zod";

const normalizePlate = (value: string) =>
	value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, ""); // remove hífen, espaço, etc.

export const RegisterUserCarDTO = z.object({
	licensePlate: z
		.string({
			required_error: "Placa é obrigatória",
			invalid_type_error: "Placa deve ser uma string",
		})
		.transform(normalizePlate)
		.refine((v) => v.length === 7, "Placa deve ter 7 caracteres (sem hífen/espaço)")
		// Opcional: valida formato BR (antiga ou Mercosul)
		.refine(
			(v) => /^[A-Z]{3}[0-9]{4}$/.test(v) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(v),
			"Placa inválida (formato não reconhecido)",
		),

	color: z
		.string({
			required_error: "Cor é obrigatória",
			invalid_type_error: "Cor deve ser uma string",
		})
		.trim()
		.min(1, "Cor é obrigatória"),

	model: z
		.string({
			required_error: "Modelo é obrigatório",
			invalid_type_error: "Modelo deve ser uma string",
		})
		.trim()
		.min(1, "Modelo é obrigatório"),

	brand: z
		.string({
			required_error: "Marca é obrigatória",
			invalid_type_error: "Marca deve ser uma string",
		})
		.trim()
		.min(1, "Marca é obrigatória"),

	year: z.coerce
		.number({
			required_error: "Ano é obrigatório",
			invalid_type_error: "Ano deve ser um número",
		})
		.int("Ano deve ser um número inteiro")
		.min(1900, "Ano inválido")
		.max(new Date().getFullYear() + 1, "Ano inválido"),

	userId: z.coerce
		.number({
			invalid_type_error: "ID do usuário deve ser um número",
		})
		.optional(),
});

export type RegisterUserCarDTO = z.infer<typeof RegisterUserCarDTO>;
