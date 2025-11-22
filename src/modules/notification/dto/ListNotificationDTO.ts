import { z } from "zod";

export const ListNotificationDTO = z.object({
	id: z.number(),
	title: z.string(),
	description: z.string(),
	type: z.enum(["USER", "MANAGER", "ALL"]),
	sentAt: z.date(),
});

export type ListNotificationDTO = z.infer<typeof ListNotificationDTO>;
