import { z } from "zod";

export const CheckDailyWashAvailabilitySchema = z.object({
	// carId: z.union([z.number(), z.string()]).transform((value) => Number(value)),
	timeZoneOffset: z.number().optional(),
});

export type CheckDailyWashAvailabilityDTO = z.infer<
	typeof CheckDailyWashAvailabilitySchema
>;
