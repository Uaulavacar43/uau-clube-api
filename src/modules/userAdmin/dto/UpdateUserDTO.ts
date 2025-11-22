import { z } from "zod";

export const UpdateUserDTO = z.object({
	id: z.coerce
		.number({
			required_error: "ID is required",
		})
		.int()
		.positive(),
	name: z.string().optional(),
	email: z
		.string()
		.email("Invalid email format")
		.optional()
		.transform((x) => (x ? x.toLowerCase() : x)),
	password: z.string().optional(),
	phone: z.string().optional(),
	role: z.enum(["USER", "ADMIN", "MANAGER"]).optional(),
	status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type UpdateUserDTO = z.infer<typeof UpdateUserDTO>;
