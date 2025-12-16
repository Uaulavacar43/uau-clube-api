import { randomBytes } from "node:crypto";

/**
 * Alfabeto Base32 customizado (sem I, O, 0, 1) para evitar ambiguidades.
 * Tamanho: 32 chars.
 */
export const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_MIN_LEN = 3;
export const REFERRAL_CODE_MAX_LEN = 32;

const BASE = REFERRAL_ALPHABET.length;

/**
 * Normaliza o código:
 * - trim
 * - uppercase
 * - remove espaços, hífen e underscore
 * - remove qualquer caractere que não seja A-Z ou 0-9
 */
export function normalizeReferralCode(code: string): string {
    return (code ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s\-_]/g, "")
        .replace(/[^A-Z0-9]/g, "");
}

/**
 * Valida formato:
 * - 3..32 chars
 * - somente caracteres do REFERRAL_ALPHABET
 *
 * Observação:
 * - Esta função normaliza internamente para evitar falsos negativos.
 */
export function isValidReferralCodeFormat(code: string): boolean {
    const normalized = normalizeReferralCode(code);

    if (normalized.length < REFERRAL_CODE_MIN_LEN || normalized.length > REFERRAL_CODE_MAX_LEN) {
        return false;
    }

    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (!REFERRAL_ALPHABET.includes(ch)) {
            return false;
        }
    }

    return true;
}

/**
 * Gera um referral code com o alfabeto permitido.
 * Default: 8 caracteres.
 */
export function generateReferralCode(len = 8): string {
    if (!Number.isInteger(len) || len < REFERRAL_CODE_MIN_LEN || len > REFERRAL_CODE_MAX_LEN) {
        throw new Error(
            `generateReferralCode: len must be an integer between ${REFERRAL_CODE_MIN_LEN} and ${REFERRAL_CODE_MAX_LEN}`,
        );
    }

    const buf = randomBytes(len);
    let out = "";

    for (let i = 0; i < len; i++) {
        out += REFERRAL_ALPHABET[buf[i] % BASE];
    }

    return out;
}

/**
 * Gera um referralCode ÚNICO com base no seu storage.
 *
 * Como usar:
 * - você passa uma função `exists(code)` que consulta o banco e diz se já existe
 * - ele tenta várias vezes até achar um código livre
 *
 * Vantagens:
 * - resolve colisões
 * - mantém o util desacoplado de Prisma/Repos
 * - e usa generateReferralCode() de verdade
 */
export async function generateUniqueReferralCode(params: {
    exists: (code: string) => Promise<boolean>;
    len?: number;
    maxAttempts?: number;
}): Promise<string> {
    const len = params.len ?? 8;
    const maxAttempts = params.maxAttempts ?? 25;

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 200) {
        throw new Error("generateUniqueReferralCode: maxAttempts must be an integer between 1 and 200");
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const candidate = generateReferralCode(len);

        // generateReferralCode já gera no alfabeto correto, mas validamos por consistência
        if (!isValidReferralCodeFormat(candidate)) {
            continue;
        }

        const exists = await params.exists(candidate);
        if (!exists) {
            return candidate;
        }
    }

    throw new Error(
        `generateUniqueReferralCode: could not generate a unique referral code after ${maxAttempts} attempts`,
    );
}
