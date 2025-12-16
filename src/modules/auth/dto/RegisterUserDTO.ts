import { z } from "zod";
import { isValidCpf } from "../../../utils/cpf";
import {
	isValidReferralCodeFormat,
	normalizeReferralCode,
	REFERRAL_CODE_MAX_LEN, REFERRAL_CODE_MIN_LEN
} from "../../referrals/utils/referralCode";


/**
 * Converte string vazia (ou só espaços) em undefined.
 * Mantém outros tipos intactos para o Zod tratar corretamente.
 */
function emptyStringToUndefined(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

export const RegisterUserDTO = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Name is required")
			.max(120, "Name is too long"),

		email: z
			.string()
			.trim()
			.email("Invalid email address")
			.transform((v) => v.toLowerCase()),

		password: z
			.string()
			.min(6, "Password must be at least 6 characters")
			.max(200, "Password is too long"),

		phone: z
			.string()
			.trim()
			.min(1, "Phone is required")
			.transform((v) => v.replace(/\D/g, ""))
			.refine(
				(v) => v.length === 10 || v.length === 11,
				"Invalid phone number",
			),

		cpf: z
			.string()
			.trim()
			.min(1, "CPF is required")
			.transform((v) => v.replace(/\D/g, ""))
			.refine((v) => v.length === 11, { message: "Invalid CPF" })
			.refine((v) => isValidCpf(v), { message: "Invalid CPF" }),

		/**
		 * Código do INDICADOR (preferencial).
		 * Campo oficial para o /auth/register.
		 */
		referrerCode: z
			.preprocess(
				emptyStringToUndefined,
				z
					.string()
					.trim()
					.min(REFERRAL_CODE_MIN_LEN, "Código inválido")
					.max(REFERRAL_CODE_MAX_LEN, "Código inválido"),
			)
			.optional(),

		/**
		 * Alias de compatibilidade:
		 * alguns clientes enviam "referralCode" significando "referrerCode".
		 * (Não confundir com o referralCode GERADO do usuário)
		 */
		referralCode: z
			.preprocess(
				emptyStringToUndefined,
				z
					.string()
					.trim()
					.min(REFERRAL_CODE_MIN_LEN, "Código inválido")
					.max(REFERRAL_CODE_MAX_LEN, "Código inválido"),
			)
			.optional(),

		firebaseToken: z
			.preprocess(emptyStringToUndefined, z.string().trim())
			.optional(),
	})
	.superRefine((data, ctx) => {
		const rawA = data.referrerCode;
		const rawB = data.referralCode;

		// Ambos ausentes: ok (indicação é opcional no register)
		if (!rawA && !rawB) {
			return;
		}

		const normalizedA = rawA ? normalizeReferralCode(rawA) : undefined;
		const normalizedB = rawB ? normalizeReferralCode(rawB) : undefined;

		if (normalizedA && !isValidReferralCodeFormat(normalizedA)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Código inválido",
				path: ["referrerCode"],
			});
		}

		if (normalizedB && !isValidReferralCodeFormat(normalizedB)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Código inválido",
				path: ["referralCode"],
			});
		}

		// Se vierem ambos, exige equivalência após normalização
		if (normalizedA && normalizedB && normalizedA !== normalizedB) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Códigos de indicação divergentes (referrerCode vs referralCode).",
				path: ["referrerCode"],
			});

			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Códigos de indicação divergentes (referralCode vs referrerCode).",
				path: ["referralCode"],
			});
		}
	})
	.transform((data) => {
		const finalReferrerCode = data.referrerCode
			? normalizeReferralCode(data.referrerCode)
			: data.referralCode
				? normalizeReferralCode(data.referralCode)
				: undefined;

		return {
			name: data.name,
			email: data.email,
			password: data.password,
			phone: data.phone,
			cpf: data.cpf,
			referrerCode: finalReferrerCode,
			firebaseToken: data.firebaseToken,
		};
	});

export type RegisterUserDTO = z.infer<typeof RegisterUserDTO>;
