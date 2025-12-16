import { cpf } from "cpf-cnpj-validator";
import { z } from "zod";

const nullishToUndef = <T>(value: T | null | undefined): T | undefined =>
	value == null ? undefined : value;

const emptyStringToUndef = (value: unknown): string | undefined => {
	if (value == null) return undefined;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
};

export const CreatePaymentSchema = z
	.object({
		// Aceita null/"" e normaliza para undefined
		coupon: z
			.string()
			.nullish()
			.transform((v) => emptyStringToUndef(v)),

		washServices: z.array(z.number()).min(1, "Selecione pelo menos um serviço"),

		type: z.enum(["creditCard", "pix"]).optional().default("creditCard"),

		// CPF opcional: aceita null/"" e só valida quando existir
		cpf: z
			.string()
			.nullish()
			.transform((value) => {
				const v = emptyStringToUndef(value);
				if (!v) return undefined;
				return v.replace(/\D/g, "");
			})
			.refine((value) => value === undefined || cpf.isValid(value), "CPF inválido"),

		creditCard: z
			.object({
				holderName: z.string(),
				number: z.string(),
				expiryMonth: z.string(),
				expiryYear: z.string(),
				ccv: z.string(),
			})
			.nullish()
			.transform(nullishToUndef),

		creditCardHolderInfo: z
			.object({
				name: z.string(),
				email: z.string().email(),
				cpfCnpj: z.string(),
				phone: z.string(),

				postalCode: z
					.string()
					.nullish()
					.transform(() => "61760046")
					.default("61760046"),

				addressNumber: z
					.string()
					.nullish()
					.transform(() => "4569")
					.default("4569"),

				// Aceita null/"" e normaliza para undefined
				addressComplement: z
					.string()
					.nullish()
					.transform((v) => emptyStringToUndef(v)),

				mobilePhone: z
					.string()
					.nullish()
					.transform((v) => emptyStringToUndef(v)),
			})
			.nullish()
			.transform(nullishToUndef),
	})
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCard) return false;
			return true;
		},
		{ message: "Faltam informações cartão", path: ["creditCard"] },
	)
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCardHolderInfo) return false;
			return true;
		},
		{ message: "Faltam informações do titular do cartão", path: ["creditCardHolderInfo"] },
	);

export type CreatePaymentDTO = z.infer<typeof CreatePaymentSchema>;
