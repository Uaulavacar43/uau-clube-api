import { z } from "zod";

export const RegisterSubscriptionSchema = z.object({
	userId: z.number({ required_error: "User ID is required" }),
	carId: z.number({ required_error: "Car ID is required" }),
	planId: z.number({ required_error: "Plan ID is required" }), // Cambio de 'plan' a 'planId'
	planType: z.enum(["MONTHLY", "ANNUAL"], {
		required_error: "Plan Type is required",
	}), // Enum para restringir valores permitidos
	amount: z
		.number({ required_error: "Amount is required" })
		.min(0, { message: "Amount must be a positive number" }),
	paymentMethod: z.string({ required_error: "Payment method is required" }),
});

export type RegisterSubscriptionDTO = z.infer<
	typeof RegisterSubscriptionSchema
>;
