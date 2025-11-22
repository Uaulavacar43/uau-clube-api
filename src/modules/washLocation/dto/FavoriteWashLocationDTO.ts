import { z } from "zod";

export const FavoriteWashLocationDTO = z.object({
	locationId: z.coerce
		.number({
			required_error: "O ID da localização é obrigatório",
			invalid_type_error: "O ID da localização deve ser um número",
		})
		.min(1, "O ID da localização deve ser maior que 0"),
});

export type FavoriteWashLocationDTO = z.infer<typeof FavoriteWashLocationDTO>;
