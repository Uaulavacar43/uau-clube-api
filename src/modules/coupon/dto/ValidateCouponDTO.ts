import { z } from "zod";

export const ValidateCouponDTO = z.object({
	code: z.string().min(1).max(255),
	planId: z.coerce.number().optional(),
	servicesIds: z.array(z.coerce.number()).optional(),
});

export type ValidateCouponDTO = z.infer<typeof ValidateCouponDTO>;
