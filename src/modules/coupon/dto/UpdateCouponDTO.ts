import { z } from "zod";

export const UpdateCouponDTO = z.object({
	code: z
		.string()
		.min(3, "Código do cupom deve ter no mínimo 3 caracteres")
		.optional(),
	description: z.string().optional(),
	additionalInfo: z.string().optional(),
	discountType: z.enum(["PERCENTAGE", "FIXED"]).optional(),
	discountValue: z
		.number()
		.refine((val) => !isNaN(val) && val > 0, {
			message: "Valor do desconto deve ser um número positivo",
		})
		.optional(),
	maxDiscountValue: z
		.number()
		.refine(
			(val) => {
				if (!val) return true;
				return !isNaN(val) && val > 0;
			},
			{
				message: "Valor máximo do desconto deve ser um número positivo",
			},
		)
		.optional(),
	validFrom: z
		.string()
		.refine((val) => !isNaN(Date.parse(val)), {
			message: "Data de início inválida",
		})
		.optional(),
	validUntil: z
		.string()
		.refine((val) => !isNaN(Date.parse(val)), {
			message: "Data de término inválida",
		})
		.optional(),
	usageLimit: z
		.number()
		.refine(
			(val) => {
				if (!val) return true;
				return !isNaN(val) && val > 0;
			},
			{
				message: "Limite de uso deve ser um número positivo",
			},
		)
		.optional(),
	isActive: z.boolean().optional(),

	planIds: z.array(z.coerce.number()).optional(),
	serviceIds: z.array(z.coerce.number()).optional(),
});

export type UpdateCouponDTO = z.infer<typeof UpdateCouponDTO>;
