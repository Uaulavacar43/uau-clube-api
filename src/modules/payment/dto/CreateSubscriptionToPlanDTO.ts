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

const toNumberOrUndef = (value: unknown): number | undefined => {
	if (value == null) return undefined;

	if (typeof value === "number") {
		if (!Number.isFinite(value)) return undefined;
		return value;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return undefined;

		const normalized = trimmed.replace(/\./g, "").replace(",", ".");
		const n = Number(normalized);

		if (!Number.isFinite(n)) return undefined;
		return n;
	}

	return undefined;
};

export const CreateSubscriptionToPlanSchema = z
	.object({
		// Plano obrigatório
		plan_id: z
			.number({
				required_error: "plan_id é obrigatório",
				invalid_type_error: "plan_id deve ser um número",
			})
			.int()
			.positive("plan_id deve ser maior que 0"),

		// Carro obrigatório
		carId: z
			.number({
				required_error: "carId é obrigatório",
				invalid_type_error: "carId deve ser um número",
			})
			.int()
			.positive("carId deve ser maior que 0"),

		// Cupom opcional
		coupon: z
			.string()
			.nullish()
			.transform((v) => emptyStringToUndef(v)),

		// Tipo de pagamento
		type: z.enum(["creditCard", "pix"]).optional().default("creditCard"),

		// CPF opcional (valida apenas se existir)
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

		// Parcelas opcionais (regras finais são aplicadas no service)
		installments: z
			.number()
			.int()
			.min(1, "installments deve ser >= 1")
			.max(24, "installments deve ser <= 24")
			.optional()
			.transform((v) => (v === undefined ? undefined : v)),

		// Offset de timezone em minutos (default -180)
		timeZoneOffset: z
			.number()
			.int()
			.optional()
			.default(-180),

		// Cashback opcional (caso você use essa lógica na assinatura também)
		cashbackAmount: z
			.preprocess((v) => toNumberOrUndef(v), z.number().optional())
			.refine(
				(v) => v === undefined || v >= 0,
				"cashbackAmount deve ser maior ou igual a 0",
			),

		// Dados do cartão (somente para creditCard)
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

		// Dados do titular do cartão
		creditCardHolderInfo: z
			.object({
				name: z.string(),
				email: z.string().email(),
				cpfCnpj: z.string(),

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

	// Regra: cartão exige dados do cartão
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCard) return false;
			return true;
		},
		{
			message: "Faltam informações cartão",
			path: ["creditCard"],
		},
	)

	// Regra: cartão exige dados do titular
	.refine(
		(data) => {
			if (data.type === "creditCard" && !data.creditCardHolderInfo)
				return false;
			return true;
		},
		{
			message: "Faltam informações do titular do cartão",
			path: ["creditCardHolderInfo"],
		},
	)

	// Telefone obrigatório APENAS para cartão
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

export type CreateSubscriptionToPlanDTO = z.infer<typeof CreateSubscriptionToPlanSchema>;
