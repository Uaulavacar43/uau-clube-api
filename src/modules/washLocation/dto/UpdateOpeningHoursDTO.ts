import { z } from "zod";

export const OpeningHourSchema = z.object({
	dayOfWeek: z.enum(
		[
			"MONDAY",
			"TUESDAY",
			"WEDNESDAY",
			"THURSDAY",
			"FRIDAY",
			"SATURDAY",
			"SUNDAY",
			"HOLIDAY",
		],
		{
			required_error: "Day of week is required",
		},
	),
	openTime: z.string({
		required_error: "Open time is required",
	}),
	closeTime: z.string({
		required_error: "Close time is required",
	}),
});

export const UpdateOpeningHoursDTO = z.array(OpeningHourSchema); // Definir como un arreglo
export type UpdateOpeningHoursDTO = z.infer<typeof UpdateOpeningHoursDTO>;
