import { z } from "zod";

export const UpdatePaymentStatusSchema = z.object({
	id: z.number().int().positive(),
	status: z.enum(["PAID", "PENDING", "CANCELED"]),
});

export type UpdatePaymentStatusDTO = z.infer<typeof UpdatePaymentStatusSchema>;
