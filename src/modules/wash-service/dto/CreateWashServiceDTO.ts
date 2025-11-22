import { z } from "zod";

export const CreateWashServiceDTO = z.object({
	name: z.string().nonempty("O nome é obrigatório"),
	price: z.preprocess(
		(val) => parseFloat(String(val)),
		z.number().positive("O preço deve ser um número positivo"),
	),
	imageUrl: z.string().optional(),
	isAvailable: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.default(false),
	isPublished: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.default(true),
	adminId: z.number().optional(),
});

export type CreateWashServiceDTO = z.infer<typeof CreateWashServiceDTO>;
