import { z } from "zod";

export const RegisterUserDTO = z
	.object({
		name: z.string({ required_error: "Name is required" }),
		email: z
			.string({ required_error: "Email is required" })
			.email("Invalid email format"),
		phone: z.string().optional(), // Phone is optional for all users
		password: z.string().optional(), // Password is required for USERS, optional for MANAGERS
		cpf: z.string().optional(), // CPF is required for USERS, optional for MANAGERS
		role: z.enum(["USER", "ADMIN", "MANAGER"], {
			required_error: "Role is required",
		}),
	})
	.refine(
		(data) => {
			// Validación adicional para requerir ciertos campos según el rol
			if (data.role === "USER") {
				return data.cpf && data.password;
			}
			return true;
		},
		{
			message: "CPF and Password are required for USER role",
			path: ["cpf", "password"],
		},
	);

export type RegisterUserDTO = z.infer<typeof RegisterUserDTO>;
