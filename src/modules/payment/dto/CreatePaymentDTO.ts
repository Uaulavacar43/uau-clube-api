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

		// Permite "10", "10.5", "10,50"
		const normalized = trimmed.replace(/\./g, "").replace(",", ".");
		const n = Number(normalized);

		if (!Number.isFinite(n)) return undefined;
		return n;
	}

	return undefined;
};

export const CreatePaymentSchema = z
	.object({
		// Cupom opcional (null/"" -> undefined)
		coupon: z
			.string()
			.nullish()
			.transform((v) => emptyStringToUndef(v)),

		// Serviços obrigatórios
		washServices: z
			.array(z.number())
			.min(1, "Selecione pelo menos um serviço"),

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

		// Cashback opcional (alinha com PaymentService: data.cashbackAmount)
		// - aceita number ou string ("10,50")
		// - null/"" -> undefined
		// - valida >= 0
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

				// phone NÃO é obrigatório no schema
				// (a obrigação real acontece no refine quando type === "creditCard")
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

export type CreatePaymentDTO = z.infer<typeof CreatePaymentSchema>;
