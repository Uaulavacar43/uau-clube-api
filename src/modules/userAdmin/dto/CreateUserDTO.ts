import { z } from "zod";

export const CreateUserDTO = z.object({
	name: z.string({ required_error: "Name is required" }),
	email: z
		.string({ required_error: "Email is required" })
		.email("Invalid email format")
		.transform((x) => x.toLowerCase()),
	password: z.string({ required_error: "Password is required" }),
	phone: z.string().optional(),
	role: z.enum(["USER", "ADMIN", "MANAGER"], {
		required_error: "Role is required",
	}),
});

export type CreateUserDTO = z.infer<typeof CreateUserDTO>;
