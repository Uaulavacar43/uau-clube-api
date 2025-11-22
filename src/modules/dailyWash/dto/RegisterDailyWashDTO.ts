import { z } from "zod";

export const RegisterDailyWashSchema = z.object({
	licensePlate: z
		.string({
			required_error: "Placa é obrigatória",
			invalid_type_error: "Placa deve ser uma string",
		})
		.min(7, "Placa deve ter no mínimo 7 caracteres")
		.trim()
		.transform((value) => value.toUpperCase()),
	washLocationId: z.coerce.number().int().optional(),
	washServiceId: z.coerce.number().int().optional(),
	timeZoneOffset: z.coerce.number().optional(),
});

export type RegisterDailyWashDTO = z.infer<typeof RegisterDailyWashSchema>;
