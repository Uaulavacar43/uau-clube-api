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

export const CreateSubscriptionToPlanSchema = z
	.object({
		plan_id: z
			.number({
				required_error: "ID do plano é obrigatório",
				invalid_type_error: "ID do plano deve ser um número",
			})
			.int("ID do plano deve ser um inteiro")
			.positive("ID do plano deve ser um número positivo"),

		// Cupom opcional (""/null -> undefined)
		coupon: z
			.string()
			.nullish()
			.transform((v) => emptyStringToUndef(v)),

		type: z.enum(["creditCard", "pix"]).optional().default("creditCard"),

		// CPF opcional: valida apenas se existir (sem exigir em pix)
		cpf: z
			.string()
			.nullish()
			.transform((value) => {
				const v = emptyStringToUndef(value);
				if (!v) return undefined;
				return v.replace(/\D/g, "");
			})
			.refine(
				(value) => value === undefined || cpf.isValid(value),
				"CPF inválido",
			),

		carId: z
			.number({
				required_error: "ID do carro é obrigatório",
				invalid_type_error: "ID do carro deve ser um número",
			})
			.int("ID do carro deve ser um inteiro")
			.positive("ID do carro deve ser um número positivo"),

		installments: z
			.number({
				invalid_type_error: "Installments deve ser um número",
			})
			.int("Installments deve ser um inteiro")
			.positive("Installments deve ser um número positivo")
			.optional(),

		washServiceId: z
			.number({
				invalid_type_error: "washServiceId deve ser um número",
			})
			.int("washServiceId deve ser um inteiro")
			.positive("washServiceId deve ser um número positivo")
			.optional(),

		timeZoneOffset: z.coerce.number().optional(),

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

				// ✅ OPÇÃO A: phone não é obrigatório no schema; vira obrigatório no refine quando creditCard
				phone: z
					.string()
					.optional()
					.transform((v) => emptyStringToUndef(v)),

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

	// 🔒 Regra: cartão exige dados do cartão
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

	// 🔒 Regra: cartão exige dados do titular
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
	)

	// ✅ OPÇÃO A — telefone obrigatório APENAS para cartão
	.refine(
		(data) => {
			if (data.type === "pix") return true;
			return Boolean(data.creditCardHolderInfo?.phone);
		},
		{
			message: "Telefone é obrigatório para cartão",
			path: ["creditCardHolderInfo", "phone"],
		},
	);

export type CreateSubscriptionToPlanDTO = z.infer<
	typeof CreateSubscriptionToPlanSchema
>;
