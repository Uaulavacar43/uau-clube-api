import { z } from "zod";

/**
 * Correção aplicada:
 * - Evita ZodEffects nos campos numéricos (usa z.coerce.number()) para permitir .int(), .positive(), .min().
 * - planType alinhado ao domínio: WEEK | MONTH | QUARTERLY | SEMIANNUALLY | YEAR
 *   (e aceita legacy "MONTHLY"/"ANNUAL" convertendo para "MONTH"/"YEAR").
 * - paymentMethod restringido e com normalização.
 */

const PeriodicityTypeEnumSchema = z.enum(
	["WEEK", "MONTH", "QUARTERLY", "SEMIANNUALLY", "YEAR"],
	{
		required_error: "Plan Type is required",
		invalid_type_error:
			"Plan Type must be one of: WEEK, MONTH, QUARTERLY, SEMIANNUALLY, YEAR",
	},
);

const PlanTypeSchema = z
	.string({
		required_error: "Plan Type is required",
		invalid_type_error: "Plan Type must be a string",
	})
	.transform((v) => v.trim().toUpperCase())
	.transform((v) => {
		// Compatibilidade com valores antigos
		if (v === "MONTHLY") return "MONTH";
		if (v === "ANNUAL") return "YEAR";
		return v;
	})
	.pipe(PeriodicityTypeEnumSchema);

const PaymentMethodEnumSchema = z.enum(["PIX", "CREDIT_CARD", "UNKNOWN"], {
	required_error: "Payment method is required",
	invalid_type_error: "Payment method must be PIX, CREDIT_CARD, or UNKNOWN",
});

const PaymentMethodSchema = z
	.string({
		required_error: "Payment method is required",
		invalid_type_error: "Payment method must be a string",
	})
	.transform((v) => v.trim().toUpperCase())
	.transform((v) => {
		// Normalizações comuns
		if (v === "CREDITCARD") return "CREDIT_CARD";
		if (v === "CREDIT-CARD") return "CREDIT_CARD";
		if (v === "CARD") return "CREDIT_CARD";
		return v;
	})
	.pipe(PaymentMethodEnumSchema);

export const RegisterSubscriptionSchema = z
	.object({
		userId: z.coerce
			.number({ required_error: "User ID is required" })
			.int({ message: "User ID must be an integer" })
			.positive({ message: "User ID must be a positive number" }),

		carId: z.coerce
			.number({ required_error: "Car ID is required" })
			.int({ message: "Car ID must be an integer" })
			.positive({ message: "Car ID must be a positive number" }),

		planId: z.coerce
			.number({ required_error: "Plan ID is required" })
			.int({ message: "Plan ID must be an integer" })
			.positive({ message: "Plan ID must be a positive number" }),

		planType: PlanTypeSchema,

		amount: z.coerce
			.number({ required_error: "Amount is required" })
			.min(0, { message: "Amount must be a non-negative number" }),

		paymentMethod: PaymentMethodSchema,
	})
	.strict();

// Se o ESLint acusar "Unused type alias" neste arquivo, você tem 3 opções:
// 1) Importar/usar RegisterSubscriptionDTO em algum lugar.
// 2) Remover este type se você não usa.
// 3) Manter e suprimir apenas aqui:
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type RegisterSubscriptionDTO = z.infer<typeof RegisterSubscriptionSchema>;
