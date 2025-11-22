import { cpf } from "cpf-cnpj-validator";
import { z } from "zod";

export const CreatePaymentSchema = z
	.object({
		coupon: z.string().optional(),
		washServices: z.array(z.number()).min(1, "Selecione pelo menos um serviço"),
		type: z.enum(["creditCard", "pix"]).optional().default("creditCard"),
		cpf: z
			.string()
			.transform((value) => value.replace(/\D/g, ""))
			.refine((value) => cpf.isValid(value), "CPF inválido")
			.optional(),

		creditCard: z
			.object({
				holderName: z.string(),
				number: z.string(),
				expiryMonth: z.string(),
				expiryYear: z.string(),
				ccv: z.string(),
			})
			.optional(),

		creditCardHolderInfo: z
			.object({
				name: z.string(),
				email: z.string().email(),
				cpfCnpj: z.string(),
				phone: z.string(),
				postalCode: z
					.string()
					.transform(() => "61760046")
					.default("61760046"),
				addressNumber: z
					.string()
					.transform(() => "4569")
					.default("4569"),
				addressComplement: z.string().optional(),
				mobilePhone: z.string().optional(),
			})
			.optional(),
	})
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCard) {
				return false;
			}
			return true;
		},
		{
			message: "Faltam informações cartão",
			path: ["creditCard"],
		},
	)
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCardHolderInfo) {
				return false;
			}
			return true;
		},
		{
			message: "Faltam informações do titular do cartão",
			path: ["creditCardHolderInfo"],
		},
	);

export type CreatePaymentDTO = z.infer<typeof CreatePaymentSchema>;
