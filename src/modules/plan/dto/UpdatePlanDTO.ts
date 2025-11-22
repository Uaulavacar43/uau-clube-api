import { z } from "zod";
import { PeriodicityType } from "../../../entities/Plan";

export const UpdatePlanSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional().nullable(),
	price: z.number().positive("Preço deve ser um número positivo").optional(),
	duration: z
		.number()
		.int()
		.positive("Duração deve ser um número inteiro positivo")
		.optional(),
	isBestChoice: z.coerce.boolean().optional(),
	isPackage: z.coerce.boolean().optional(),
	periodicityType: z.nativeEnum(PeriodicityType).optional(),
	washServiceIds: z.array(z.number()).optional(),
	extraMonths: z.coerce.number().nullable().optional(),
});

export type UpdatePlanDTO = z.infer<typeof UpdatePlanSchema>;
