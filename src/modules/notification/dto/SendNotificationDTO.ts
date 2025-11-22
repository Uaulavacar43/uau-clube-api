import { z } from "zod";

export const SendNotificationDTO = z.object({
	title: z.string().min(3, "Title must have at least 3 characters"),
	description: z.string().min(5, "Description must have at least 5 characters"),
	type: z.enum(["USER", "MANAGER", "ALL"]),
	isAutomatic: z.boolean().optional(),
});

// Tipo inferido de Zod
export type SendNotificationDTO = z.infer<typeof SendNotificationDTO>;
