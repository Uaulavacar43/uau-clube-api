import { z } from "zod";

export const ListTopSoldServicesDTO = z.object({
	page: z.coerce.number().positive().optional().default(1),
	pageSize: z.coerce.number().positive().optional().default(12),
	search: z.string().optional(),
	orderBy: z
		.enum(["name", "price", "createdAt"])
		.optional()
		.default("createdAt"),
	order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type ListTopSoldServicesDTO = z.infer<typeof ListTopSoldServicesDTO>;
