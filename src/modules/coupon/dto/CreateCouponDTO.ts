import { z } from "zod";

export const CreateCouponDTO = z.object({
	code: z
		.string({
			required_error: "Código do cupom é obrigatório",
			invalid_type_error: "Código do cupom deve ser uma string",
		})
		.min(3, "Código do cupom deve ter no mínimo 3 caracteres"),

	description: z
		.string({
			invalid_type_error: "Descrição do cupom deve ser uma string",
		})
		.optional(),

	additionalInfo: z.string().optional(),

	discountType: z.enum(["PERCENTAGE", "FIXED"], {
		required_error: "Tipo de desconto é obrigatório",
		invalid_type_error: "Tipo de desconto deve ser PERCENTAGE ou FIXED",
	}),

	discountValue: z
		.number({
			required_error: "Valor do desconto é obrigatório",
			invalid_type_error: "Valor do desconto deve ser um número",
		})
		.refine((val) => !isNaN(val) && val > 0, {
			message: "Valor do desconto deve ser um número positivo",
		}),

	maxDiscountValue: z
		.number()
		.optional()
		.refine(
			(val) => {
				if (!val) return true;
				return !isNaN(val) && val > 0;
			},
			{
				message: "Valor máximo do desconto deve ser um número positivo",
			},
		),

	validFrom: z
		.string({
			invalid_type_error: "Data de início deve ser uma string",
		})
		.refine((val) => !isNaN(Date.parse(val)), {
			message: "Data de início inválida",
		})
		.default(() => new Date().toISOString()),

	validUntil: z
		.string({
			required_error: "Data de término é obrigatória",
			invalid_type_error: "Data de término deve ser uma string",
		})
		.refine((val) => !isNaN(Date.parse(val)), {
			message: "Data de término inválida",
		}),

	usageLimit: z
		.number()
		.optional()
		.refine(
			(val) => {
				if (!val) return true;
				return !isNaN(val) && val > 0;
			},
			{
				message: "Limite de uso deve ser um número positivo",
			},
		),

	planIds: z.array(z.coerce.number()).optional(),
	serviceIds: z.array(z.coerce.number()).optional(),
});

export type CreateCouponDTO = z.infer<typeof CreateCouponDTO>;
