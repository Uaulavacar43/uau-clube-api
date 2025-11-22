import { z } from "zod";

export const GetAllWashLocationsDTO = z.object({
	favorited: z.coerce.boolean().optional(),
});

export type GetAllWashLocationsDTO = z.infer<typeof GetAllWashLocationsDTO>;
