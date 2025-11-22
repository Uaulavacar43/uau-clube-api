import { z } from "zod";

export const LoginUserDTO = z.object({
	email: z.string().email(),
	password: z.string(),
	firebaseToken: z.string().optional(), // Token opcional en login
});

export type LoginUserDTO = z.infer<typeof LoginUserDTO>;
