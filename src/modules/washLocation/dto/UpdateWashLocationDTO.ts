import { z } from "zod";

export const UpdateWashLocationDTO = z.object({
	name: z.string().optional(),
	images: z.array(z.string()).optional(),
	street: z.string().optional(),
	number: z.string().optional(),
	neighborhood: z.string().optional(),
	city: z.string().optional(),
	phoneNumber: z.string().optional(),
	flow: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
	isActive: z.boolean().optional(),
});

export type UpdateWashLocationDTO = z.infer<typeof UpdateWashLocationDTO>;
