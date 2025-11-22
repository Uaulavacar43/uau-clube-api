import { z } from "zod";

export const UpdateWashServiceDTO = z.object({
	name: z.string().optional(),
	price: z.preprocess((val) => {
		const parsed = parseFloat(String(val));
		return isNaN(parsed) ? undefined : parsed;
	}, z.number().positive("Price must be a positive number").optional()),
	imageUrl: z.string().optional(),
	isAvailable: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.optional(),
	isPublished: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.optional(),
	adminId: z.number().optional(),
});

export type UpdateWashServiceDTO = z.infer<typeof UpdateWashServiceDTO>;
