import { z } from "zod";

export const GetAllPaymentsWithDetailsDTO = z.object({
	page: z.coerce.number().optional().default(1),
	pageSize: z.coerce.number().optional().default(10),
	status: z.enum(["PAID", "PENDING", "CANCELED"]).optional(),
});

export type GetAllPaymentsWithDetailsDTO = z.infer<
	typeof GetAllPaymentsWithDetailsDTO
>;
