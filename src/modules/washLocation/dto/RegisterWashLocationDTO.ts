import { z } from "zod";

export const RegisterWashLocationDTO = z.object({
	name: z.string({ required_error: "Name is required" }),
	images: z.array(z.string()).optional().default([]),
	street: z.string({ required_error: "Street is required" }),
	number: z.string({ required_error: "Number is required" }),
	neighborhood: z.string({ required_error: "Neighborhood is required" }),
	city: z.string({ required_error: "City is required" }),
	phoneNumber: z.string().optional(),
	managerId: z.number({ required_error: "Manager ID is required" }),
	flow: z.enum(["LOW", "MODERATE", "HIGH"]).default("LOW"),
});

export type RegisterWashLocationDTO = z.infer<typeof RegisterWashLocationDTO>;
