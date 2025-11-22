import { z } from "zod";
import { PeriodicityType } from "../../../entities/Plan";

export const CreatePlanSchema = z.object({
	name: z.string().min(1, "Nome é obrigatório"),
	description: z.string().optional().nullable(),
	price: z.number().positive("Preço deve ser um número positivo"),
	duration: z
		.number()
		.int()
		.positive("Duração deve ser um número inteiro positivo"),
	isBestChoice: z.coerce.boolean().optional().default(false),
	isPackage: z.coerce.boolean().optional().default(false),
	periodicityType: z
		.nativeEnum(PeriodicityType)
		.optional()
		.default(PeriodicityType.MONTH),
	washServiceIds: z.array(z.number()).optional(),
	extraMonths: z.coerce.number().nullable().optional().default(null),
});

export type CreatePlanDTO = z.infer<typeof CreatePlanSchema>;
