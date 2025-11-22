import { z } from "zod";

export const ListServicesWithLocationsDTO = z.object({
	page: z.coerce.number().default(1),
	pageSize: z.coerce.number().default(10),
	isAvailable: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.optional(),
	showPurchasedCount: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.optional(),
	userId: z.coerce.number().optional(),
});

export type ListServicesWithLocationsDTO = z.infer<
	typeof ListServicesWithLocationsDTO
>;
