import { z } from "zod";
import {isValidReferralCodeFormat, normalizeReferralCode} from "../utils/referralCode";


const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
    z.preprocess((v) => {
        if (typeof v !== "string") return v;
        const trimmed = v.trim();
        return trimmed.length === 0 ? undefined : trimmed;
    }, schema);

export const ValidateReferralDTO = z
    .object({
        /**
         * Campo legacy / compat:
         * - cliente pode enviar "referralCode"
         */
        referralCode: emptyStringToUndefined(
            z
                .string()
                .trim()
                .min(3, "O código de indicação é inválido")
                .max(32, "O código de indicação é inválido"),
        ).optional(),

        /**
         * Campo alternativo:
         * - alguns fluxos podem usar "referrerCode"
         */
        referrerCode: emptyStringToUndefined(
            z
                .string()
                .trim()
                .min(3, "O código de indicação é inválido")
                .max(32, "O código de indicação é inválido"),
        ).optional(),
    })
    .superRefine((data, ctx) => {
        const code = data.referralCode ?? data.referrerCode;

        if (!code) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "O código de indicação é obrigatório",
                path: ["referralCode"],
            });
            return;
        }

        const normalized = normalizeReferralCode(code);

        if (!isValidReferralCodeFormat(normalized)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "O código de indicação é inválido",
                path: ["referralCode"],
            });
        }

        if (data.referralCode && data.referrerCode) {
            const a = normalizeReferralCode(data.referralCode);
            const b = normalizeReferralCode(data.referrerCode);

            if (a !== b) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Códigos de indicação divergentes (referralCode vs referrerCode).",
                    path: ["referralCode"],
                });
            }
        }
    })
    .transform((data) => {
        const code = data.referralCode ?? data.referrerCode ?? "";
        return {
            referralCode: normalizeReferralCode(code),
        };
    });

export type ValidateReferralDTO = z.infer<typeof ValidateReferralDTO>;
