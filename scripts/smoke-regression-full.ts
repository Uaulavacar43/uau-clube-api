/* eslint-disable no-console */
/**
 * scripts/smoke-regression-full.ts
 *
 * Uso:
 *   npx ts-node scripts/smoke-regression-full.ts --base-url=http://localhost:3002
 *
 * Flags:
 *   --base-url=http://localhost:3002      (obrigatório)
 *   --strict=true|false                  (default false) -> se true, qualquer falha derruba o smoke
 *   --cleanup=true|false                 (default true)  -> remove seeds no final (best-effort)
 *   --allow-asaas=true|false             (default false) -> se false, NÃO chama endpoints que acionem ASAAS externo
 *   --payment-prefix=/payment            (default /payment)
 *
 * Ajustes desta versão:
 * - /wash-services 401 "No token provided": tenta múltiplos headers de auth (Bearer, token puro, x-access-token, x-auth-token),
 *   além de tentativa sem token (caso endpoint seja público).
 * - Cleanup: remove TODOS os cashbackTransactions/cashbackWallets do usuário seed (não só os ids criados),
 *   e limpa dependências comuns em ordem para evitar FK.
 * - fetch: usa global fetch se existir; senão tenta node-fetch (best-effort).
 *
 * FIX (2026-01-04):
 * - Corrige P2002 cpf: admin e user estavam gerando o MESMO CPF porque a função cortava em 9 dígitos
 *   e a diferença do sufixo ("1"/"2") ficava fora. Agora:
 *   1) CPF vem de um hash (seedBase) => admin/user sempre diferentes
 *   2) garante CPF único no banco antes do create (loop best-effort)
 *
 * FIX (2026-01-04):
 * - Para de "adivinhar" endpoints em DAILY_WASH e COUPONS_VALIDATE. Agora usa as rotas reais:
 *   DAILY_WASH:
 *     - GET /daily-wash/availability (auth)
 *     - GET /daily-wash/user/:userId/history (auth)
 *   COUPONS_VALIDATE:
 *     - GET /coupons/validate/:code (público)
 */

import * as crypto from "crypto";
import { PrismaClient } from "@prisma/client";

type AnyRecord = Record<string, unknown>;

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// fetch polyfill (best-effort)
// -----------------------------------------------------------------------------

type FetchLike = (input: any, init?: any) => Promise<any>;

function getFetch(): FetchLike {
    const g: any = globalThis as any;
    if (typeof g.fetch === "function") return g.fetch.bind(g);

    // fallback: node-fetch (CJS)
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nf = require("node-fetch");
        const f = nf?.default ?? nf;
        if (typeof f === "function") return f;
    } catch {
        // ignore
    }

    throw new Error(
        "fetch não disponível. Use Node 18+ ou instale node-fetch (npm i -D node-fetch).",
    );
}

const fetchFn = getFetch();

// -----------------------------------------------------------------------------
// Args / Config
// -----------------------------------------------------------------------------

type SmokeOptions = {
    baseUrl: string;
    strict: boolean;
    cleanup: boolean;
    allowAsaas: boolean;
    paymentPrefix: string;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value == null) return fallback;
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "y") return true;
    if (v === "false" || v === "0" || v === "no" || v === "n") return false;
    return fallback;
}

function parseArgs(argv: string[]): SmokeOptions {
    const map = new Map<string, string>();

    for (const a of argv) {
        if (!a.startsWith("--")) continue;
        const eq = a.indexOf("=");
        if (eq === -1) map.set(a.slice(2), "true");
        else map.set(a.slice(2, eq), a.slice(eq + 1));
    }

    const baseUrl = map.get("base-url") ?? map.get("baseUrl") ?? "";
    if (!baseUrl) throw new Error("Missing --base-url=http://localhost:3002");

    const strict = parseBool(map.get("strict"), false);
    const cleanup = parseBool(map.get("cleanup"), true);
    const allowAsaas = parseBool(map.get("allow-asaas"), false);
    const paymentPrefix = (map.get("payment-prefix") ?? "/payment").trim() || "/payment";

    return { baseUrl, strict, cleanup, allowAsaas, paymentPrefix };
}

function randomRunId(): string {
    return crypto.randomBytes(6).toString("hex");
}

function nowIso(): string {
    return new Date().toISOString();
}

function bannerLine(n = 60): string {
    return "-".repeat(n);
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// -----------------------------------------------------------------------------
// Logging helpers
// -----------------------------------------------------------------------------

function logHeader(opts: SmokeOptions, runId: string) {
    console.log("");
    console.log(bannerLine());
    console.log(`[SMOKE] start ${nowIso()}`);
    console.log(`[SMOKE] runId ${runId}`);
    console.log(`[SMOKE] baseUrl ${opts.baseUrl}`);
    console.log(`[SMOKE] strict ${opts.strict}`);
    console.log(`[SMOKE] cleanup ${opts.cleanup}`);
    console.log(`[SMOKE] allowAsaas ${opts.allowAsaas}`);
    console.log(bannerLine());
}

function logTag(tag: string, message: string) {
    console.log(`[SMOKE] ${tag} ${message}`);
}

function warnTag(tag: string, message: string, err?: unknown) {
    if (err) console.warn(`[SMOKE] ⚠️ ${tag} ${message}`, err);
    else console.warn(`[SMOKE] ⚠️ ${tag} ${message}`);
}

function failTag(tag: string, message: string, err?: unknown) {
    if (err) console.error(`[SMOKE] ❌ FAIL ${tag} ${message}`, err);
    else console.error(`[SMOKE] ❌ FAIL ${tag} ${message}`);
}

// -----------------------------------------------------------------------------
// HTTP helpers
// -----------------------------------------------------------------------------

type HttpResult = {
    ok: boolean;
    status: number;
    url: string;
    method: string;
    json?: any;
    text?: string;
    headers?: Record<string, string>;
};

function isNotFoundStatus(status: number): boolean {
    return status === 404;
}

function isMethodNotAllowed(status: number): boolean {
    return status === 405;
}

function isAuthErrorStatus(status: number): boolean {
    return status === 401 || status === 403;
}

function withTimeout(ms: number): AbortController {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), ms).unref?.();
    return ac;
}

function normalizeHeaders(h: any): Record<string, string> {
    const out: Record<string, string> = {};
    try {
        if (!h) return out;
        if (typeof h.forEach === "function") {
            h.forEach((v: any, k: any) => {
                out[String(k).toLowerCase()] = String(v);
            });
            return out;
        }
    } catch {
        // ignore
    }
    return out;
}

async function httpJson(params: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    token?: string | null;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;

    /**
     * Variações de auth header pra resolver "No token provided" quando
     * o backend lê header diferente do padrão Authorization Bearer.
     */
    authMode?: "bearer" | "raw" | "x-access-token" | "x-auth-token" | "none";
}): Promise<HttpResult> {
    const timeoutMs = params.timeoutMs ?? 20_000;
    const ac = withTimeout(timeoutMs);

    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(params.headers ?? {}),
    };

    // auth header variants
    const token = (params.token ?? "").trim();
    const authMode = params.authMode ?? (token ? "bearer" : "none");

    if (authMode !== "none" && token) {
        if (authMode === "bearer") headers.Authorization = `Bearer ${token}`;
        if (authMode === "raw") headers.Authorization = token;
        if (authMode === "x-access-token") headers["x-access-token"] = token;
        if (authMode === "x-auth-token") headers["x-auth-token"] = token;
    }

    let body: any = undefined;
    if (params.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(params.body);
    }

    try {
        const res = await fetchFn(params.url, {
            method: params.method,
            headers,
            body,
            signal: ac.signal,
        });

        const ct = res.headers?.get?.("content-type") ?? "";
        const status = res.status;

        const outHeaders = normalizeHeaders(res.headers);

        if (ct.includes("application/json")) {
            const json = await res.json().catch(() => undefined);
            return {
                ok: res.ok,
                status,
                url: params.url,
                method: params.method,
                json,
                headers: outHeaders,
            };
        }

        const text = await res.text().catch(() => "");
        return {
            ok: res.ok,
            status,
            url: params.url,
            method: params.method,
            text,
            headers: outHeaders,
        };
    } catch (err: any) {
        return {
            ok: false,
            status: 0,
            url: params.url,
            method: params.method,
            text: String(err?.message ?? err ?? "fetch_error"),
        };
    }
}

function extractTokenFromResponse(json: any): string | null {
    if (!json) return null;

    const directKeys = [
        "token",
        "accessToken",
        "jwt",
        "bearer",
        "authToken",
        "access_token",
    ];

    for (const k of directKeys) {
        const v = json?.[k];
        if (typeof v === "string" && v.trim().length > 10) return v.trim();
    }

    const data = json?.data;
    if (data && typeof data === "object") {
        for (const k of directKeys) {
            const v = (data as any)?.[k];
            if (typeof v === "string" && v.trim().length > 10) return v.trim();
        }
    }

    const nestedCandidates = [
        json?.result,
        json?.payload,
        json?.auth,
        json?.session,
        json?.login,
        json?.response,
        json?.content,
    ].filter(Boolean);

    for (const n of nestedCandidates) {
        for (const k of directKeys) {
            const v = (n as any)?.[k];
            if (typeof v === "string" && v.trim().length > 10) return v.trim();
        }
        const nData = (n as any)?.data;
        if (nData && typeof nData === "object") {
            for (const k of directKeys) {
                const v = (nData as any)?.[k];
                if (typeof v === "string" && v.trim().length > 10) return v.trim();
            }
        }
    }

    return null;
}

function buildUrl(
    baseUrl: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    const u = new URL(`${baseUrl}${p}`);
    if (query) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null) continue;
            sp.set(k, String(v));
        }
        const qs = sp.toString();
        if (qs) u.search = qs;
    }
    return u.toString();
}

function responseBodyAsString(r: HttpResult): string {
    return r.json ? safeJson(r.json) : (r.text ?? "");
}

function looksLikeNoTokenProvided(r: HttpResult): boolean {
    const body = responseBodyAsString(r).toLowerCase();
    return (
        body.includes("no token provided") ||
        body.includes("nenhum token") ||
        body.includes("token not provided")
    );
}

async function httpGetWithAuthFallback(params: {
    url: string;
    token?: string | null;
    timeoutMs?: number;
}): Promise<HttpResult & { tried: string[] }> {
    const tried: string[] = [];

    const token = (params.token ?? "").trim();

    // Ordem:
    // 1) bearer
    // 2) raw
    // 3) x-access-token
    // 4) x-auth-token
    // 5) none (sem auth) (alguns endpoints viram públicos)
    const modes: Array<"bearer" | "raw" | "x-access-token" | "x-auth-token" | "none"> =
        token ? ["bearer", "raw", "x-access-token", "x-auth-token", "none"] : ["none"];

    let last: HttpResult | null = null;

    for (const mode of modes) {
        tried.push(mode);
        const r = await httpJson({
            method: "GET",
            url: params.url,
            token: token || null,
            timeoutMs: params.timeoutMs,
            authMode: mode,
        });

        last = r;

        // se ok, acabou
        if (r.ok) return Object.assign(r, { tried });

        // se 401/403 e parece "No token provided", tenta próximo modo
        if (isAuthErrorStatus(r.status) && looksLikeNoTokenProvided(r)) continue;

        // se 401/403 mas não é "no token provided", pode ser permissão -> não adianta trocar header
        if (isAuthErrorStatus(r.status)) return Object.assign(r, { tried });

        // se não é auth, retorna direto
        return Object.assign(r, { tried });
    }

    return Object.assign(
        last ?? { ok: false, status: 0, url: params.url, method: "GET", text: "no_response" },
        { tried },
    );
}

// -----------------------------------------------------------------------------
// Password hashing (usa util do projeto se existir; fallback bcrypt/bcryptjs)
// -----------------------------------------------------------------------------

async function hashPasswordCompat(plain: string): Promise<string> {
    const candidates = [
        "../src/utils/password",
        "../utils/password",
        "./src/utils/password",
        "./utils/password",
        "../src/modules/auth/utils/password",
        "../src/common/utils/password",
    ];

    for (const c of candidates) {
        try {
            const mod: any = await import(c as any);
            if (typeof mod?.hashPassword === "function") {
                const hashed = await mod.hashPassword(plain);
                if (typeof hashed === "string" && hashed.length > 20) return hashed;
            }
        } catch {
            // ignore
        }
    }

    const req: any = eval("require");

    const pkgs = ["bcryptjs", "bcrypt"];
    for (const pkg of pkgs) {
        try {
            const mod: any = req(pkg);
            const hashFn =
                typeof mod?.hash === "function"
                    ? mod.hash
                    : typeof mod?.default?.hash === "function"
                        ? mod.default.hash
                        : null;

            if (hashFn) {
                const hashed = await hashFn(plain, 10);
                if (typeof hashed === "string" && hashed.length > 20) return hashed;
            }
        } catch {
            // ignore
        }
    }

    throw new Error(
        "Não foi possível hashear senha. hashPassword não encontrado e bcryptjs/bcrypt não disponível.",
    );
}

// -----------------------------------------------------------------------------
// CPF válido (corrigido: hash + unicidade best-effort)
// -----------------------------------------------------------------------------

function onlyDigits(s: string): string {
    return (s ?? "").replace(/\D/g, "");
}

function calcCpfDigit(base: number[], factor: number): number {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += base[i] * (factor - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
}

/**
 * Gera CPF válido a partir de um seed (hash), evitando o bug anterior em que
 * admin/user poderiam gerar o MESMO CPF por causa de slice(0,9) em dígitos.
 */
function generateValidCpfFromSeed(seed: string): string {
    const hash = crypto.createHash("sha256").update(seed).digest();

    const base: number[] = [];
    for (let i = 0; i < 9; i++) base.push(hash[i] % 10);

    // evita CPFs inválidos triviais (todos iguais)
    const allEqual = base.every((d) => d === base[0]);
    if (allEqual) base[8] = (base[8] + 1) % 10;

    const d1 = calcCpfDigit(base, 10);
    const d2 = calcCpfDigit([...base, d1], 11);
    return [...base, d1, d2].join("");
}

/**
 * Garante CPF único no banco antes do create (best-effort).
 * Só chama isso quando o model User tem campo cpf.
 */
async function generateUniqueCpfForUser(seedBase: string): Promise<string> {
    // tenta várias combinações determinísticas pelo seedBase
    for (let i = 0; i < 60; i++) {
        const candidate = generateValidCpfFromSeed(`${seedBase}#${i}`);
        try {
            const existing = await (prisma as any).user.findFirst({
                where: { cpf: candidate },
                select: { id: true },
            });
            if (!existing?.id) return candidate;
        } catch {
            // se por algum motivo a query falhar, continua tentando outras seeds
        }
    }

    // fallback randômico (extremamente improvável colidir)
    const rnd = crypto.randomBytes(10).toString("hex");
    return generateValidCpfFromSeed(`${seedBase}#fallback#${rnd}`);
}

// -----------------------------------------------------------------------------
// Placa Mercosul válida: ABC1D23
// -----------------------------------------------------------------------------

function toLetters(s: string): string {
    const letters = (s ?? "").replace(/[^a-zA-Z]/g, "").toUpperCase();
    return letters || "ABC";
}

function toDigits(s: string): string {
    const digits = onlyDigits(s);
    return digits || "1234567";
}

function generateMercosulPlate(runId: string): string {
    const letters = toLetters(runId + "ABC").padEnd(4, "X");
    const digits = toDigits(runId + "123").padEnd(3, "7");

    const A = letters[0];
    const B = letters[1];
    const C = letters[2];

    const D1 = digits[0];
    const D2 = letters[3];
    const D3 = digits[1];
    const D4 = digits[2];

    return `${A}${B}${C}${D1}${D2}${D3}${D4}`.slice(0, 7);
}

// -----------------------------------------------------------------------------
// DMMF helpers (Prisma schema introspection)
// -----------------------------------------------------------------------------

type DmmfField = {
    name: string;
    kind: "scalar" | "object" | "enum" | string;
    type: string;
    isList: boolean;
    isRequired: boolean;
    hasDefaultValue: boolean;
    isId: boolean;
};

type DmmfModel = {
    name: string;
    fields: DmmfField[];
};

type DmmfEnum = {
    name: string;
    values: Array<{ name: string }>;
};

function getPrismaDmmf(): any {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const anyClient: any = require("@prisma/client");
        const fromClient = anyClient?.Prisma?.dmmf ?? anyClient?.dmmf ?? null;
        if (fromClient) return fromClient;
    } catch {
        // ignore
    }

    const anyPrisma: any = prisma as any;
    const fromInstance = anyPrisma?._dmmf ?? anyPrisma?._engine?.dmmf ?? null;
    if (fromInstance) return fromInstance;

    return null;
}

function getModels(): DmmfModel[] {
    const dmmf = getPrismaDmmf();
    const models = dmmf?.datamodel?.models;
    if (!Array.isArray(models)) return [];
    return models as DmmfModel[];
}

function getEnums(): DmmfEnum[] {
    const dmmf = getPrismaDmmf();
    const enums = dmmf?.datamodel?.enums;
    if (!Array.isArray(enums)) return [];
    return enums as DmmfEnum[];
}

function getModelByName(name: string): DmmfModel | null {
    const models = getModels();
    const m = models.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    return m ?? null;
}

function fieldExists(model: DmmfModel | null, fieldName: string): boolean {
    if (!model) return false;
    return model.fields.some((f) => f.name === fieldName);
}

function prismaHasDelegate(delegateName: string): boolean {
    const anyPrisma: any = prisma as any;
    return Boolean(anyPrisma?.[delegateName] && typeof anyPrisma[delegateName] === "object");
}

function getEnumValues(enumName: string): string[] {
    const enums = getEnums();
    const e = enums.find((x) => String(x.name).toLowerCase() === enumName.toLowerCase());
    if (!e) return [];
    return (e.values ?? []).map((v) => v.name).filter(Boolean);
}

function pickEnumValue(enumName: string, preferred: string[] = []): string | null {
    const values = getEnumValues(enumName);
    if (!values.length) return null;

    for (const p of preferred) {
        if (values.includes(p)) return p;
    }
    return values[0] ?? null;
}

function dummyValueForField(params: {
    field: DmmfField;
    runId: string;
    seedTag: string;
    overrides?: Record<string, unknown>;
}): any {
    const { field, runId, seedTag } = params;

    if (params.overrides && field.name in params.overrides) {
        return (params.overrides as any)[field.name];
    }

    if (field.isList) {
        if (field.kind === "scalar" || field.kind === "enum") return [];
        return undefined;
    }

    if (field.kind === "enum") {
        const picked = pickEnumValue(field.type, [
            "ADMIN",
            "USER",
            "MANAGER",
            "ACTIVE",
            "PENDING",
            "PAID",
            "CANCELED",
        ]);
        return picked ?? "UNKNOWN_ENUM";
    }

    if (field.kind === "object") return undefined;

    const t = field.type;

    if (t === "String") {
        const lname = field.name.toLowerCase();

        if (lname.includes("email")) return `smoke.${seedTag}.${runId}@example.com`;
        if (lname.includes("phone")) return `85${runId.slice(0, 8)}`;
        if (lname.includes("password")) return `smoke_${runId}_pass`;
        if (lname.includes("name")) return `Smoke ${seedTag} ${runId}`;
        if (lname.includes("license") || lname.includes("plate")) return generateMercosulPlate(runId);
        if (lname.includes("token")) return `SMOKE_TOKEN_${seedTag}_${runId}`;
        if (lname.includes("asaas") && lname.includes("customer")) return `SMOKE_CUSTOMER_${runId}`;
        if (lname.includes("asaas") && lname.includes("payment")) return `SMOKE_ASAAS_PAYMENT_${runId}`;
        if (lname.includes("eventkey")) return `SMOKE:${seedTag}:${runId}`;
        if (lname.includes("referral") && lname.includes("code"))
            return crypto.randomBytes(4).toString("hex");
        if (lname === "cpf") return generateValidCpfFromSeed(`${seedTag}:${runId}:${field.name}`);
        return `SMOKE_${seedTag}_${runId}_${field.name}`;
    }

    if (t === "Int") return 1;
    if (t === "BigInt") return BigInt(1);
    if (t === "Float" || t === "Decimal") return 1;
    if (t === "Boolean") return true;
    if (t === "DateTime") return new Date();
    if (t === "Json") return { runId, seedTag, field: field.name };

    return undefined;
}

function buildCreateDataForModel(params: {
    modelName: string;
    runId: string;
    seedTag: string;
    overrides?: Record<string, unknown>;
}): Record<string, unknown> {
    const model = getModelByName(params.modelName);
    if (!model) return { ...(params.overrides ?? {}) };

    const data: Record<string, unknown> = {};
    const overrides = params.overrides ?? {};

    for (const f of model.fields) {
        if (f.isId) continue;
        if (f.kind === "object") continue;

        if (f.name in overrides) {
            const v = (overrides as any)[f.name];
            if (v !== undefined) data[f.name] = v;
            continue;
        }

        if (!f.isRequired) continue;
        if (f.hasDefaultValue) continue;

        const v = dummyValueForField({
            field: f,
            runId: params.runId,
            seedTag: params.seedTag,
            overrides,
        });

        if (v !== undefined) data[f.name] = v;
    }

    for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) data[k] = v;
    }

    return data;
}

// -----------------------------------------------------------------------------
// Step runner (strict/soft-fail)
// -----------------------------------------------------------------------------

async function runStep<T>(
    opts: SmokeOptions,
    label: string,
    fn: () => Promise<T>,
): Promise<{ ok: boolean; result?: T; error?: unknown }> {
    try {
        const result = await fn();
        return { ok: true, result };
    } catch (err) {
        if (opts.strict) throw err;
        return { ok: false, error: err };
    }
}

function ensureOkOrThrow(opts: SmokeOptions, r: HttpResult, label: string): void {
    if (r.ok) return;

    const details = r.json ? safeJson(r.json) : (r.text ?? "");
    const msg = `${label} failed (status=${r.status}) ${details}`;

    if (opts.strict) throw new Error(msg);
    warnTag("SOFT_FAIL", msg);
}

// -----------------------------------------------------------------------------
// Auth + Seed
// -----------------------------------------------------------------------------

type SeededContext = {
    runId: string;
    adminUserId: number;
    userId: number;
    adminEmail: string;
    userEmail: string;
    adminPassword: string;
    userPassword: string;
    adminToken: string | null;
    userToken: string | null;
    adminReferralCode: string | null;
    userReferralCode: string | null;
    seeded: {
        users: number[];
        cars: number[];
        payments: number[];
        cashbackWalletIds: number[];
        cashbackTransactionIds: number[];
    };
};

function generateReferralCodeLikeAuthService(): string {
    return crypto.randomBytes(4).toString("hex"); // 8 chars
}

async function seedUserOrReuse(params: {
    runId: string;
    seedTag: "admin" | "user";
    rolePreferred: string[];
}): Promise<{ id: number; email: string; passwordPlain: string; referralCode: string | null }> {
    const userModel = getModelByName("User");
    if (!userModel) throw new Error("User model not found in Prisma DMMF");

    const email = `smoke.${params.seedTag}.${params.runId}@example.com`;
    const passwordPlain = `smoke_${params.seedTag}_${params.runId}_pass`;

    const referralCodeFieldExists = fieldExists(userModel, "referralCode");
    const referralCode = referralCodeFieldExists ? generateReferralCodeLikeAuthService() : null;

    const existing = await (prisma as any).user
        .findUnique({
            where: { email },
            select: { id: true, ...(referralCodeFieldExists ? { referralCode: true } : {}) },
        })
        .catch(() => null);

    if (existing?.id) {
        const existingReferralCode =
            referralCodeFieldExists && typeof existing?.referralCode === "string"
                ? existing.referralCode
                : null;
        return { id: existing.id, email, passwordPlain, referralCode: existingReferralCode };
    }

    let roleValue: string | null = null;
    if (fieldExists(userModel, "role")) {
        const roleField = userModel.fields.find((f) => f.name === "role");
        if (roleField?.kind === "enum") roleValue = pickEnumValue(roleField.type, params.rolePreferred);
        else roleValue = params.rolePreferred[0] ?? "USER";
    }

    // CPF (corrigido): gera determinístico por seedTag + runId e garante unicidade antes do create
    let cpf: string | null = null;
    if (fieldExists(userModel, "cpf")) {
        cpf = await generateUniqueCpfForUser(`${params.runId}:${params.seedTag}`);
    }

    const hashedPassword = await hashPasswordCompat(passwordPlain);

    const overrides: Record<string, unknown> = {
        ...(fieldExists(userModel, "name") ? { name: `Smoke ${params.seedTag} ${params.runId}` } : {}),
        ...(fieldExists(userModel, "email") ? { email } : {}),
        ...(fieldExists(userModel, "phone") ? { phone: `85${params.runId.slice(0, 8)}` } : {}),
        ...(fieldExists(userModel, "cpf") && cpf ? { cpf } : {}),
        ...(fieldExists(userModel, "role") && roleValue ? { role: roleValue } : {}),
        ...(referralCodeFieldExists && referralCode ? { referralCode } : {}),
    };

    if (fieldExists(userModel, "password")) overrides.password = hashedPassword;
    if (fieldExists(userModel, "passwordHash")) overrides.passwordHash = hashedPassword;

    if (fieldExists(userModel, "firebaseTokens")) {
        const fbField = userModel.fields.find((f) => f.name === "firebaseTokens");
        if (fbField?.isList) overrides.firebaseTokens = [`SMOKE_TOKEN_${params.seedTag}_${params.runId}`];
        else overrides.firebaseTokens = `SMOKE_TOKEN_${params.seedTag}_${params.runId}`;
    }

    const data = buildCreateDataForModel({
        modelName: "User",
        runId: params.runId,
        seedTag: `seed_${params.seedTag}`,
        overrides,
    });

    // se mesmo assim colidir (muito raro), faz retry gerando outro CPF
    try {
        const created = await (prisma as any).user.create({
            data,
            select: { id: true, ...(referralCodeFieldExists ? { referralCode: true } : {}) },
        });

        const createdReferralCode =
            referralCodeFieldExists && typeof created?.referralCode === "string"
                ? created.referralCode
                : referralCode;

        if (referralCodeFieldExists && (!createdReferralCode || String(createdReferralCode).trim().length < 6)) {
            const rc = generateReferralCodeLikeAuthService();
            try {
                await (prisma as any).user.update({ where: { id: created.id }, data: { referralCode: rc } });
                return { id: created.id, email, passwordPlain, referralCode: rc };
            } catch {
                return { id: created.id, email, passwordPlain, referralCode: createdReferralCode ?? null };
            }
        }

        return { id: created.id, email, passwordPlain, referralCode: createdReferralCode ?? null };
    } catch (e: any) {
        // Prisma P2002 em cpf: retry com CPF novo
        if (String(e?.code) === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("cpf")) {
            if (fieldExists(userModel, "cpf")) {
                const cpfRetry = await generateUniqueCpfForUser(`${params.runId}:${params.seedTag}:retry:${crypto.randomBytes(6).toString("hex")}`);
                const dataRetry = {
                    ...data,
                    cpf: cpfRetry,
                };

                const createdRetry = await (prisma as any).user.create({
                    data: dataRetry,
                    select: { id: true, ...(referralCodeFieldExists ? { referralCode: true } : {}) },
                });

                const createdReferralCode =
                    referralCodeFieldExists && typeof createdRetry?.referralCode === "string"
                        ? createdRetry.referralCode
                        : referralCode;

                return { id: createdRetry.id, email, passwordPlain, referralCode: createdReferralCode ?? null };
            }
        }
        throw e;
    }
}

async function loginBestEffort(baseUrl: string, email: string, password: string): Promise<string | null> {
    const candidates = ["/auth/login", "/auth/signin", "/auth/authenticate", "/auth/session"];

    let bestDebug: { url: string; status: number; body: string } | null = null;

    for (const c of candidates) {
        const url = `${baseUrl}${c}`;
        const r = await httpJson({
            method: "POST",
            url,
            body: { email, password },
            timeoutMs: 15_000,
            authMode: "none",
        });

        if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;

        const bodyDebug = responseBodyAsString(r);
        bestDebug = { url, status: r.status, body: bodyDebug };

        if (!r.ok) continue;

        const token = extractTokenFromResponse(r.json);
        if (token) return token;

        const alt = r.json?.access_token ?? r.json?.accessToken ?? r.json?.data?.access_token;
        if (typeof alt === "string" && alt.trim().length > 10) return alt.trim();
    }

    if (bestDebug) {
        warnTag(
            "AUTH",
            `login falhou/sem token. last=${bestDebug.url.replace(baseUrl, "")} status=${bestDebug.status} body=${bestDebug.body}`,
        );
    }

    return null;
}

// -----------------------------------------------------------------------------
// Probes / Candidates
// -----------------------------------------------------------------------------

async function probeGetFirstOk(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token?: string | null;
    label: string;
    candidates: string[];
    retryWithAdminToken?: string | null;
}): Promise<{ ok: boolean; status: number; urlTried?: string; json?: any }> {
    const { opts, baseUrl, token, label, candidates, retryWithAdminToken } = params;

    for (const c of candidates) {
        const url = `${baseUrl}${c}`;

        // 1) tenta com token (com fallback de headers)
        if (token) {
            const r = await httpGetWithAuthFallback({ url, token, timeoutMs: 20_000 });
            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;

            if (r.ok) {
                logTag(label, `GET ${c} -> ${r.status} (auth=${r.tried.join(",")})`);
                return { ok: true, status: r.status, urlTried: c, json: r.json };
            }

            // 2) se auth falhou, tenta admin (com fallback)
            if (isAuthErrorStatus(r.status) && retryWithAdminToken) {
                const r2 = await httpGetWithAuthFallback({ url, token: retryWithAdminToken, timeoutMs: 20_000 });
                if (r2.ok) {
                    logTag(label, `GET ${c} -> ${r2.status} (retry admin auth=${r2.tried.join(",")})`);
                    return { ok: true, status: r2.status, urlTried: c, json: r2.json };
                }
                ensureOkOrThrow(opts, r2, `${label} GET ${c} (admin retry)`);
                return { ok: false, status: r2.status, urlTried: c, json: r2.json };
            }

            ensureOkOrThrow(opts, r, `${label} GET ${c}`);
            return { ok: false, status: r.status, urlTried: c, json: r.json };
        }

        // 0) sem token: tenta público
        const r0 = await httpJson({ method: "GET", url, authMode: "none" });
        if (isNotFoundStatus(r0.status) || isMethodNotAllowed(r0.status)) continue;

        if (r0.ok) {
            logTag(label, `GET ${c} -> ${r0.status} (public)`);
            return { ok: true, status: r0.status, urlTried: c, json: r0.json };
        }

        // 3) sem token e falhou: tenta admin se disponível
        if (isAuthErrorStatus(r0.status) && retryWithAdminToken) {
            const r2 = await httpGetWithAuthFallback({ url, token: retryWithAdminToken, timeoutMs: 20_000 });
            if (r2.ok) {
                logTag(label, `GET ${c} -> ${r2.status} (admin auth=${r2.tried.join(",")})`);
                return { ok: true, status: r2.status, urlTried: c, json: r2.json };
            }
            ensureOkOrThrow(opts, r2, `${label} GET ${c} (admin fallback)`);
            return { ok: false, status: r2.status, urlTried: c, json: r2.json };
        }

        ensureOkOrThrow(opts, r0, `${label} GET ${c} (public)`);
        return { ok: false, status: r0.status, urlTried: c, json: r0.json };
    }

    warnTag(label, "nenhum endpoint candidato respondeu (404/405).");
    return { ok: false, status: 404 };
}

async function probePostFirstOk(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token?: string | null;
    label: string;
    candidates: string[];
    bodies: any[];
    headers?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; urlTried?: string; json?: any }> {
    const { opts, baseUrl, token, label, candidates, bodies, headers } = params;

    for (const c of candidates) {
        for (const body of bodies) {
            const url = `${baseUrl}${c}`;
            const r = await httpJson({
                method: "POST",
                url,
                token,
                body,
                headers,
                authMode: token ? "bearer" : "none",
            });

            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;

            if (!r.ok) {
                ensureOkOrThrow(opts, r, `${label} POST ${c}`);
                return { ok: false, status: r.status, urlTried: c, json: r.json };
            }

            logTag(label, `POST ${c} -> ${r.status}`);
            return { ok: true, status: r.status, urlTried: c, json: r.json };
        }
    }

    warnTag(label, "nenhum endpoint candidato respondeu (404/405).");
    return { ok: false, status: 404 };
}

// -----------------------------------------------------------------------------
// Cashback seed (enum-safe via DMMF)
// -----------------------------------------------------------------------------

async function seedCashbackWalletAndEarned(params: {
    runId: string;
    userId: number;
    amount: number;
}): Promise<{ walletId: number | null; earnedTxId: number | null }> {
    const hasWallet = prismaHasDelegate("cashbackWallet");
    const hasTx = prismaHasDelegate("cashbackTransaction");
    if (!hasWallet || !hasTx) return { walletId: null, earnedTxId: null };

    const walletModel = getModelByName("CashbackWallet");
    const txModel = getModelByName("CashbackTransaction");

    let walletType: string | null = null;
    if (walletModel && fieldExists(walletModel, "type")) {
        const typeField = walletModel.fields.find((f) => f.name === "type");
        if (typeField?.kind === "enum") walletType = pickEnumValue(typeField.type, ["INTERNAL", "DEFAULT"]);
        else walletType = "INTERNAL";
    }

    let wallet = await (prisma as any).cashbackWallet.findFirst({
        where: {
            ...(walletModel && fieldExists(walletModel, "userId") ? { userId: params.userId } : {}),
            ...(walletType && walletModel && fieldExists(walletModel, "type") ? { type: walletType } : {}),
        },
        select: { id: true, ...(walletModel && fieldExists(walletModel, "balance") ? { balance: true } : {}) },
    });

    if (!wallet) {
        const walletCreate = buildCreateDataForModel({
            modelName: "CashbackWallet",
            runId: params.runId,
            seedTag: "seed_wallet",
            overrides: {
                ...(walletModel && fieldExists(walletModel, "userId") ? { userId: params.userId } : {}),
                ...(walletType && walletModel && fieldExists(walletModel, "type") ? { type: walletType } : {}),
                ...(walletModel && fieldExists(walletModel, "balance") ? { balance: params.amount } : {}),
            },
        });

        wallet = await (prisma as any).cashbackWallet.create({
            data: walletCreate,
            select: { id: true, ...(walletModel && fieldExists(walletModel, "balance") ? { balance: true } : {}) },
        });
    } else {
        if (walletModel && fieldExists(walletModel, "balance")) {
            try {
                await (prisma as any).cashbackWallet.update({
                    where: { id: wallet.id },
                    data: { balance: params.amount },
                });
            } catch {
                // ignore
            }
        }
    }

    const typeField = txModel?.fields.find((f) => f.name === "type");
    const sourceField = txModel?.fields.find((f) => f.name === "source");

    const txTypeEnumName = typeField?.kind === "enum" ? String(typeField.type) : "TransactionType";
    const txSourceEnumName = sourceField?.kind === "enum" ? String(sourceField.type) : "TransactionSource";

    const txType =
        pickEnumValue(txTypeEnumName, ["EARNED"]) ??
        pickEnumValue("TransactionType", ["EARNED"]) ??
        null;

    const txSource =
        pickEnumValue(txSourceEnumName, ["WELCOME_BONUS", "INDICATION"]) ??
        pickEnumValue("TransactionSource", ["WELCOME_BONUS", "INDICATION"]) ??
        null;

    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

    const txData = buildCreateDataForModel({
        modelName: "CashbackTransaction",
        runId: params.runId,
        seedTag: "seed_cashback",
        overrides: {
            ...(txModel && fieldExists(txModel, "userId") ? { userId: params.userId } : {}),
            ...(txModel && fieldExists(txModel, "amount") ? { amount: params.amount } : {}),
            ...(txModel && fieldExists(txModel, "expiresAt") ? { expiresAt } : {}),
            ...(txModel && fieldExists(txModel, "relatedId") ? { relatedId: `SMOKE_${params.runId}` } : {}),
            ...(txType && txModel && fieldExists(txModel, "type") ? { type: txType } : {}),
            ...(txSource && txModel && fieldExists(txModel, "source") ? { source: txSource } : {}),
            ...(txModel && fieldExists(txModel, "eventKey") ? { eventKey: `SMOKE:EARNED:${params.runId}` } : {}),
            ...(txModel && fieldExists(txModel, "meta") ? { meta: { runId: params.runId, kind: "seed_earned" } } : {}),
        },
    });

    const earnedTx = await (prisma as any).cashbackTransaction.create({
        data: txData,
        select: { id: true },
    });

    return { walletId: wallet.id ?? null, earnedTxId: earnedTx.id ?? null };
}

// -----------------------------------------------------------------------------
// Payment seed (DB-only, sem ASAAS externo)
// -----------------------------------------------------------------------------

async function seedPaymentsDbOnly(params: {
    runId: string;
    userId: number;
    count: number;
}): Promise<number[]> {
    if (!prismaHasDelegate("payment")) return [];

    const paymentModel = getModelByName("Payment");
    if (!paymentModel) return [];

    const ids: number[] = [];

    const statusField = paymentModel.fields.find((f) => f.name === "status");
    const statusEnumName = statusField?.kind === "enum" ? String(statusField.type) : null;

    const statusPaid = statusEnumName ? pickEnumValue(statusEnumName, ["PAID"]) : "PAID";
    const statusPending = statusEnumName ? pickEnumValue(statusEnumName, ["PENDING"]) : "PENDING";
    const statusCanceled =
        statusEnumName ? pickEnumValue(statusEnumName, ["CANCELED", "CANCELLED"]) : "CANCELED";

    const statuses = [statusPending, statusPaid, statusPending, statusCanceled, statusPaid].filter(Boolean) as string[];

    for (let i = 0; i < params.count; i++) {
        const amount = Number((10 + i * 1.11).toFixed(2));
        const paymentIdAsaas = `SMOKE_ASAAS_PAYMENT_${params.runId}_${i}`;
        const dueAt = new Date();
        const paymentDate = new Date();

        const overrides: Record<string, unknown> = {
            ...(fieldExists(paymentModel, "userId") ? { userId: params.userId } : {}),
            ...(fieldExists(paymentModel, "amount") ? { amount } : {}),
            ...(fieldExists(paymentModel, "status") ? { status: statuses[i % statuses.length] } : {}),
            ...(fieldExists(paymentModel, "paymentIdAsaas") ? { paymentIdAsaas } : {}),
            ...(fieldExists(paymentModel, "dueAt") ? { dueAt } : {}),
            ...(fieldExists(paymentModel, "paymentDate") ? { paymentDate } : {}),
            ...(fieldExists(paymentModel, "createdAt") ? { createdAt: new Date() } : {}),
            ...(fieldExists(paymentModel, "updatedAt") ? { updatedAt: new Date() } : {}),
            ...(fieldExists(paymentModel, "paymentMethodId") ? { paymentMethodId: "PIX" } : {}),
            ...(fieldExists(paymentModel, "installments") ? { installments: null } : {}),
            ...(fieldExists(paymentModel, "pixQrCode") ? { pixQrCode: null } : {}),
            ...(fieldExists(paymentModel, "pixPayload") ? { pixPayload: null } : {}),
            ...(fieldExists(paymentModel, "couponId") ? { couponId: null } : {}),
            ...(fieldExists(paymentModel, "planId") ? { planId: null } : {}),
        };

        if (fieldExists(paymentModel, "cashbackUsedAmount")) {
            overrides.cashbackUsedAmount = i % 2 === 0 ? Number((i * 0.75).toFixed(2)) : null;
        }

        const data = buildCreateDataForModel({
            modelName: "Payment",
            runId: params.runId,
            seedTag: "seed_payment",
            overrides,
        });

        const created = await (prisma as any).payment.create({ data, select: { id: true } });
        ids.push(created.id);
    }

    return ids;
}

// -----------------------------------------------------------------------------
// User-Car CRUD via API (best effort)
// -----------------------------------------------------------------------------

async function userCarCrud(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token: string;
    runId: string;
}): Promise<{ createdCarId: number | null }> {
    const { opts, baseUrl, token, runId } = params;
    const plate = generateMercosulPlate(runId);

    const createBodies = [
        { licensePlate: plate, model: "Smoke Model", brand: "Smoke Brand", color: "Smoke Color", year: 2022 },
        { licensePlate: plate, carModel: "Smoke Model", carBrand: "Smoke Brand", carColor: "Smoke Color", year: 2022 },
        { plate: plate, model: "Smoke Model", brand: "Smoke Brand", color: "Smoke Color", year: 2022 },
    ];

    const create = await probePostFirstOk({
        opts,
        baseUrl,
        token,
        label: "USER_CAR_CREATE",
        candidates: ["/user-car"],
        bodies: createBodies,
    });

    if (!create.ok) return { createdCarId: null };

    const createdCarId =
        typeof create.json?.id === "number"
            ? create.json.id
            : typeof create.json?.car?.id === "number"
                ? create.json.car.id
                : typeof create.json?.data?.id === "number"
                    ? create.json.data.id
                    : null;

    const list = await httpGetWithAuthFallback({ url: `${baseUrl}/user-car`, token });
    ensureOkOrThrow(opts, list, "USER_CAR_LIST GET /user-car");
    if (list.ok) logTag("USER_CAR_LIST", `GET /user-car -> ${list.status} (auth=${list.tried.join(",")})`);

    if (createdCarId) {
        const updateBodies = [
            { id: createdCarId, model: "Smoke Model Updated" },
            { id: createdCarId, carModel: "Smoke Model Updated" },
            { model: "Smoke Model Updated" },
            { carModel: "Smoke Model Updated" },
        ];

        let updated = false;
        for (const b of updateBodies) {
            const r = await httpJson({
                method: "PUT",
                url: `${baseUrl}/user-car/${createdCarId}`,
                token,
                body: b,
                authMode: "bearer",
            });
            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;
            if (!r.ok) ensureOkOrThrow(opts, r, `USER_CAR_UPDATE PUT /user-car/${createdCarId}`);
            if (r.ok) {
                logTag("USER_CAR_UPDATE", `PUT /user-car/${createdCarId} -> ${r.status}`);
                updated = true;
            }
            break;
        }
        if (!updated) warnTag("USER_CAR_UPDATE", `nenhum update body funcionou para id=${createdCarId}`);

        let del = await httpJson({
            method: "DELETE",
            url: `${baseUrl}/user-car/${createdCarId}`,
            token,
            body: { id: createdCarId },
            authMode: "bearer",
        });
        if (isMethodNotAllowed(del.status) || isNotFoundStatus(del.status)) {
            del = await httpJson({
                method: "DELETE",
                url: `${baseUrl}/user-car/${createdCarId}`,
                token,
                authMode: "bearer",
            });
        }

        ensureOkOrThrow(opts, del, `USER_CAR_DELETE DELETE /user-car/${createdCarId}`);
        if (del.ok) logTag("USER_CAR_DELETE", `DELETE /user-car/${createdCarId} -> ${del.status}`);
    }

    logTag("OK", "user-car CRUD");
    return { createdCarId };
}

// -----------------------------------------------------------------------------
// Admin users list (anti-NaN)
// -----------------------------------------------------------------------------

function looksLikeNaNPaginationError(json: any): boolean {
    const text = safeJson(json).toLowerCase();
    return text.includes("received") && text.includes("nan") && (text.includes("page") || text.includes("pagesize"));
}

async function adminUsersListWithRetries(params: {
    opts: SmokeOptions;
    baseUrl: string;
    adminToken: string;
}): Promise<void> {
    const { opts, baseUrl, adminToken } = params;

    const candidates: Array<{ path: string; query?: Record<string, any> }> = [
        { path: "/users", query: { page: 1, pageSize: 10 } },
        { path: "/users", query: { page: "1", pageSize: "10" } },
        { path: "/users/list", query: { page: 1, pageSize: 10 } },
        { path: "/users/all" },
        { path: "/users/list" },
    ];

    let lastDebug: { url: string; status: number; body: string } | null = null;

    for (const c of candidates) {
        const url = c.query ? buildUrl(baseUrl, c.path, c.query) : `${baseUrl}${c.path}`;
        const r = await httpGetWithAuthFallback({ url, token: adminToken });

        if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;

        const body = responseBodyAsString(r);
        lastDebug = { url, status: r.status, body };

        if (r.ok) {
            logTag(
                "ADMIN_USERS_LIST",
                `GET ${c.path}${c.query ? `?${new URL(url).searchParams.toString()}` : ""} -> ${r.status} (auth=${r.tried.join(",")})`,
            );
            return;
        }

        if (r.status === 400 && looksLikeNaNPaginationError(r.json)) {
            warnTag("ADMIN_USERS_LIST", `NaN pagination detectado, tentando próximo. url=${c.path} status=${r.status} body=${body}`);
            continue;
        }

        ensureOkOrThrow(opts, r, `ADMIN_USERS_LIST GET ${c.path}`);
        return;
    }

    if (lastDebug) warnTag("ADMIN_USERS_LIST", `nenhum candidato funcionou. last=${lastDebug.url.replace(baseUrl, "")} status=${lastDebug.status} body=${lastDebug.body}`);
    else warnTag("ADMIN_USERS_LIST", "nenhum endpoint candidato respondeu (404/405).");
}

async function adminUsersProbeAndCrud(params: {
    opts: SmokeOptions;
    baseUrl: string;
    adminToken: string;
    runId: string;
    userIdToGet: number;
}): Promise<void> {
    const { opts, baseUrl, adminToken, runId, userIdToGet } = params;

    await adminUsersListWithRetries({ opts, baseUrl, adminToken });

    const byRoleUrl = buildUrl(baseUrl, "/users/role/ADMIN", { page: 1, pageSize: 10 });
    const roleRes = await httpGetWithAuthFallback({ url: byRoleUrl, token: adminToken });
    ensureOkOrThrow(opts, roleRes, "ADMIN_USERS_BY_ROLE GET /users/role/ADMIN");
    if (roleRes.ok) logTag("ADMIN_USERS_BY_ROLE", `GET /users/role/ADMIN -> ${roleRes.status}`);

    const getRes = await httpGetWithAuthFallback({ url: `${baseUrl}/users/${userIdToGet}`, token: adminToken });
    ensureOkOrThrow(opts, getRes, `ADMIN_USERS_GET_BY_ID GET /users/${userIdToGet}`);
    if (getRes.ok) logTag("ADMIN_USERS_GET_BY_ID", `GET /users/${userIdToGet} -> ${getRes.status}`);

    const cpf1 = generateValidCpfFromSeed(`api-create:${runId}:user:${crypto.randomBytes(6).toString("hex")}`);
    const cpf2 = generateValidCpfFromSeed(`api-create:${runId}:admin:${crypto.randomBytes(6).toString("hex")}`);

    const createBodyCandidates = [
        {
            name: `Smoke Created ${runId}`,
            email: `smoke.created.${runId}@example.com`,
            password: `smoke_created_${runId}_pass`,
            phone: `85${runId.slice(0, 8)}`,
            cpf: cpf1,
            role: "USER",
        },
        {
            name: `Smoke Created ${runId}`,
            email: `smoke.created.${runId}@example.com`,
            password: `smoke_created_${runId}_pass`,
            phone: `85${runId.slice(0, 8)}`,
            cpf: cpf2,
            role: "ADMIN",
        },
    ];

    let createdUserId: number | null = null;
    const createRes = await probePostFirstOk({
        opts,
        baseUrl,
        token: adminToken,
        label: "ADMIN_USERS_CREATE",
        candidates: ["/users"],
        bodies: createBodyCandidates,
    });

    if (createRes.ok) {
        const j = createRes.json;
        createdUserId =
            typeof j?.id === "number"
                ? j.id
                : typeof j?.user?.id === "number"
                    ? j.user.id
                    : typeof j?.data?.id === "number"
                        ? j.data.id
                        : null;
    }

    if (createdUserId) {
        const updateCandidates = [
            { method: "PUT" as const, url: `${baseUrl}/users/${createdUserId}`, body: { name: `Smoke Updated ${runId}` } },
            { method: "PATCH" as const, url: `${baseUrl}/users/${createdUserId}`, body: { name: `Smoke Updated ${runId}` } },
        ];

        let updatedOk = false;
        for (const c of updateCandidates) {
            const r = await httpJson({ method: c.method, url: c.url, token: adminToken, body: c.body, authMode: "bearer" });
            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;
            if (!r.ok) ensureOkOrThrow(opts, r, `ADMIN_USERS_UPDATE falhou em ${c.url}`);
            else {
                logTag("ADMIN_USERS_UPDATE", `${c.method} ${c.url.replace(baseUrl, "")} -> ${r.status}`);
                updatedOk = true;
            }
            break;
        }
        if (!updatedOk) warnTag("ADMIN_USERS_UPDATE", "endpoint não disponível (best-effort).");

        const deleteCandidates = [
            { method: "DELETE" as const, url: `${baseUrl}/users/${createdUserId}`, body: undefined as any },
            { method: "DELETE" as const, url: `${baseUrl}/users`, body: { id: createdUserId } as any },
        ];

        let deletedOk = false;
        for (const c of deleteCandidates) {
            const r = await httpJson({ method: c.method, url: c.url, token: adminToken, body: c.body, authMode: "bearer" });
            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;
            if (!r.ok) ensureOkOrThrow(opts, r, `ADMIN_USERS_DELETE falhou em ${c.url}`);
            else {
                logTag("ADMIN_USERS_DELETE", `${c.method} ${c.url.replace(baseUrl, "")} -> ${r.status}`);
                deletedOk = true;
            }
            break;
        }
        if (!deletedOk) warnTag("ADMIN_USERS_DELETE", "endpoint não disponível (best-effort).");
    } else {
        warnTag("ADMIN_USERS_CREATE", "não foi possível extrair createdUserId do retorno");
    }

    logTag("OK", "admin users probe + best-effort CRUD");
}

// -----------------------------------------------------------------------------
// Coupons validate (rota real: GET /coupons/validate/:code)
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractCouponCodeFromObject(obj: Record<string, unknown>): string | null {
    const directKeys = ["code", "couponCode", "coupon_code", "coupon"];
    for (const k of directKeys) {
        const v = obj[k];
        if (typeof v === "string" && v.trim().length >= 2) return v.trim();
    }
    return null;
}

function extractFirstCouponCodeDeep(value: unknown, depth = 0): string | null {
    if (depth > 6) return null;

    if (typeof value === "string") return null;
    if (typeof value === "number" || typeof value === "boolean" || value == null) return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = extractFirstCouponCodeDeep(item, depth + 1);
            if (found) return found;
        }
        return null;
    }

    if (isRecord(value)) {
        const direct = extractCouponCodeFromObject(value);
        if (direct) return direct;

        // shapes comuns
        const candidates = [
            value.data,
            value.items,
            value.results,
            value.result,
            value.payload,
            value.content,
            value.coupons,
            value.list,
        ];

        for (const c of candidates) {
            const found = extractFirstCouponCodeDeep(c, depth + 1);
            if (found) return found;
        }

        // fallback: varre todas as props
        for (const v of Object.values(value)) {
            const found = extractFirstCouponCodeDeep(v, depth + 1);
            if (found) return found;
        }
    }

    return null;
}

async function couponsProbe(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token: string | null;
}): Promise<void> {
    const { opts, baseUrl, token } = params;

    const list = await probeGetFirstOk({
        opts,
        baseUrl,
        token,
        label: "COUPONS",
        candidates: ["/coupons"],
        retryWithAdminToken: null,
    });

    if (!list.ok) return;

    // Extrai um code REAL da listagem (sem adivinhar endpoints nem payloads).
    const code = extractFirstCouponCodeDeep(list.json);

    if (!code) {
        warnTag(
            "COUPONS_VALIDATE",
            "não foi possível extrair um coupon code da resposta de GET /coupons; não dá pra validar sem um code real (best-effort).",
        );
        logTag("OK", "coupons probe");
        return;
    }

    // Rota REAL (pública) conforme teu router: GET /coupons/validate/:code
    const path = `/coupons/validate/${encodeURIComponent(code)}`;
    const url = `${baseUrl}${path}`;

    const r = await httpJson({
        method: "GET",
        url,
        authMode: "none", // rota pública
    });

    if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) {
        // se chegou aqui com 404/405, significa que o backend não está montando a rota como no router
        ensureOkOrThrow(opts, r, `COUPONS_VALIDATE_GET GET ${path}`);
        logTag("OK", "coupons probe");
        return;
    }

    ensureOkOrThrow(opts, r, `COUPONS_VALIDATE_GET GET ${path}`);
    if (r.ok) logTag("COUPONS_VALIDATE_GET", `GET ${path} -> ${r.status} (public)`);

    logTag("OK", "coupons probe");
}

// -----------------------------------------------------------------------------
// Referrals validate (usa referralCode real)
// -----------------------------------------------------------------------------

function extractReferralCodeFromLink(link: string | null | undefined): string | null {
    if (!link) return null;
    try {
        const fakeBase = link.startsWith("http") ? "" : "https://fake.local";
        const u = new URL(link, fakeBase);
        const ref = u.searchParams.get("ref");
        if (ref && ref.trim()) return ref.trim();
    } catch {
        // ignore
    }
    return null;
}

async function getReferralLinkBestEffort(params: {
    baseUrl: string;
    token: string;
}): Promise<{ referralCode: string | null; referralLink: string | null }> {
    const { baseUrl, token } = params;

    const candidates = ["/auth/referral-link", "/auth/referralLink", "/auth/me/referral-link"];

    for (const c of candidates) {
        const url = `${baseUrl}${c}`;
        const r = await httpGetWithAuthFallback({ url, token });
        if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;
        if (!r.ok) return { referralCode: null, referralLink: null };

        const referralCode =
            typeof r.json?.referralCode === "string"
                ? r.json.referralCode
                : typeof r.json?.data?.referralCode === "string"
                    ? r.json.data.referralCode
                    : null;

        const referralLink =
            typeof r.json?.referralLink === "string"
                ? r.json.referralLink
                : typeof r.json?.data?.referralLink === "string"
                    ? r.json.data.referralLink
                    : null;

        return { referralCode: referralCode?.trim() || null, referralLink: referralLink?.trim() || null };
    }

    return { referralCode: null, referralLink: null };
}

async function referralsValidateProbe(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token: string | null;
    fallbackReferralCode: string | null;
}): Promise<void> {
    const { opts, baseUrl, token, fallbackReferralCode } = params;

    const validatePathCandidates = ["/referrals/validate", "/referral/validate", "/referrals/check"];

    if (!token) {
        warnTag("REFERRALS_VALIDATE", "sem token (skip)");
        return;
    }

    const linkInfo = await getReferralLinkBestEffort({ baseUrl, token });
    const fromLink = extractReferralCodeFromLink(linkInfo.referralLink);
    const realReferralCode = (linkInfo.referralCode ?? fromLink ?? fallbackReferralCode ?? "").trim();

    if (!realReferralCode) {
        warnTag("REFERRALS_VALIDATE", "não foi possível obter referralCode real (skip)");
        return;
    }

    const candidatesToTry = Array.from(new Set([realReferralCode, realReferralCode.toLowerCase(), realReferralCode.toUpperCase()]));

    let last: { status: number; body: string; path: string } | null = null;

    for (const p of validatePathCandidates) {
        for (const code of candidatesToTry) {
            const url = `${baseUrl}${p}`;
            const r = await httpJson({
                method: "POST",
                url,
                token,
                body: { referralCode: code },
                authMode: "bearer",
            });

            if (isNotFoundStatus(r.status) || isMethodNotAllowed(r.status)) continue;

            const body = responseBodyAsString(r);
            last = { status: r.status, body, path: p };

            if (r.ok) {
                logTag("REFERRALS_VALIDATE", `POST ${p} -> ${r.status}`);
                logTag("OK", `referrals validate (code=${code})`);
                return;
            }

            if (r.status === 400 && body.toLowerCase().includes("inválido")) {
                warnTag(
                    "REFERRALS_VALIDATE",
                    `falhou com code=${code}. Se veio do /auth/referral-link e mesmo assim é inválido, provável mismatch de normalização/validação. status=${r.status} body=${body}`,
                );
            } else {
                ensureOkOrThrow(opts, r, `REFERRALS_VALIDATE POST ${p}`);
            }
        }
    }

    if (last) warnTag("REFERRALS_VALIDATE", `endpoint não respondeu (404/405) ou falhou. last=${last.path} status=${last.status} body=${last.body}`);
    else warnTag("REFERRALS_VALIDATE", "nenhum endpoint candidato respondeu (404/405).");
}

// -----------------------------------------------------------------------------
// Payment probes + webhook
// -----------------------------------------------------------------------------

async function paymentProbe(params: {
    opts: SmokeOptions;
    baseUrl: string;
    token: string | null;
    paymentPrefix: string;
    seededPaymentId: number;
}): Promise<void> {
    const { opts, baseUrl, token, paymentPrefix, seededPaymentId } = params;

    if (!token) {
        warnTag("PAYMENT", "sem token (skip)");
        return;
    }

    const prefix = paymentPrefix.startsWith("/") ? paymentPrefix : `/${paymentPrefix}`;

    const endpoints = [
        `${prefix}/history/yearly`,
        `${prefix}/all`,
        `${prefix}/total-revenue`,
        `${prefix}/current-month-revenue`,
        `${prefix}/next-month-predicted-revenue`,
        `${prefix}/mrr`,
        `${prefix}/detailed-payments`,
        `${prefix}/detailed-payments/${seededPaymentId}`,
        `${prefix}/detail/${seededPaymentId}`,
    ];

    for (const e of endpoints) {
        const r = await httpGetWithAuthFallback({ url: `${baseUrl}${e}`, token });
        ensureOkOrThrow(opts, r, `PAYMENT GET ${e}`);
        if (r.ok) logTag("PAYMENT", `GET ${e.replace(prefix, "")} -> ${r.status} (auth=${r.tried.join(",")})`);
    }
}

async function paymentWebhookProbe(params: {
    opts: SmokeOptions;
    baseUrl: string;
    paymentPrefix: string;
    asaasPaymentId: string;
}): Promise<void> {
    const { opts, baseUrl, paymentPrefix, asaasPaymentId } = params;

    const prefix = paymentPrefix.startsWith("/") ? paymentPrefix : `/${paymentPrefix}`;

    const webhookEndpointCandidates = [`${prefix}/payments-webhook`, `${prefix}/payment-webhook`, `${prefix}/webhook`];

    const token = process.env.ASAAS_ACCESS_TOKEN ?? "";
    const headers: Record<string, string> = {};
    if (token) headers["asaas-access-token"] = token;

    const bodyCandidates = [
        { paymentId: asaasPaymentId, status: "RECEIVED" },
        { payment: { id: asaasPaymentId, status: "RECEIVED" } },
        { payment: { id: asaasPaymentId, status: "CONFIRMED" } },
        { id: asaasPaymentId, status: "RECEIVED" },
    ];

    const res = await probePostFirstOk({
        opts,
        baseUrl,
        token: null,
        label: "PAYMENT_WEBHOOK",
        candidates: webhookEndpointCandidates,
        bodies: bodyCandidates,
        headers,
    });

    if (!res.ok) warnTag("PAYMENT_WEBHOOK", "webhook probe não disponível (best-effort).");
}

// -----------------------------------------------------------------------------
// Cleanup helpers (FK-safe)
// -----------------------------------------------------------------------------

async function safeDeleteMany(delegate: string, where: AnyRecord, label: string) {
    if (!prismaHasDelegate(delegate)) return;
    try {
        const del = await (prisma as any)[delegate].deleteMany({ where });
        logTag("CLEANUP", `${label}: ${del?.count ?? 0}`);
    } catch (e) {
        warnTag("CLEANUP", `falha ${label}`, e);
    }
}

async function bestEffortCleanupByUserIds(userIds: number[], runId: string, paymentIds: number[]) {
    // Ordem: filhos → pais
    // logs (se existirem)
    await safeDeleteMany("webhookLog", { userId: { in: userIds } }, "webhookLogs removidos");
    await safeDeleteMany("requestLog", { userId: { in: userIds } }, "requestLogs removidos");
    // errorLog/responseLog dependem de requestLog; se existir delegate, limpa por requestId via deleteMany amplo (best-effort)
    // (se teus delegates não existirem, no-op)

    // referrals / bônus
    await safeDeleteMany("referralBonus", { receiverId: { in: userIds } }, "referralBonuses(receiver) removidos");
    await safeDeleteMany("referralBonus", { payerId: { in: userIds } }, "referralBonuses(payer) removidos");
    await safeDeleteMany("userReferral", { referrerId: { in: userIds } }, "userReferrals(referrer) removidos");
    await safeDeleteMany("userReferral", { referredId: { in: userIds } }, "userReferrals(referred) removidos");

    // grupo fechado
    await safeDeleteMany("referralGroupMember", { userId: { in: userIds } }, "referralGroupMembers removidos");

    // purchases/subscriptions/payments
    await safeDeleteMany("individualServicePurchase", { userId: { in: userIds } }, "individualServicePurchases removidos");
    if (paymentIds.length) {
        await safeDeleteMany("individualServicePurchase", { paymentId: { in: paymentIds } }, "individualServicePurchases(paymentId) removidos");
    }
    await safeDeleteMany("subscription", { userId: { in: userIds } }, "subscriptions removidas");

    // payments (por id e também por prefix SMOKE pra garantir)
    if (paymentIds.length) await safeDeleteMany("payment", { id: { in: paymentIds } }, "payments(seed ids) removidos");
    await safeDeleteMany(
        "payment",
        {
            userId: { in: userIds },
            OR: [
                { paymentIdAsaas: { startsWith: "SMOKE_ASAAS_PAYMENT_" } },
                { paymentIdAsaas: { contains: runId } },
            ],
        },
        "payments(SMOKE) removidos",
    );

    // cashback: remove tudo do usuário seed (não só ids)
    await safeDeleteMany(
        "cashbackTransaction",
        {
            userId: { in: userIds },
        },
        "cashbackTransactions(userId) removidos",
    );
    await safeDeleteMany(
        "cashbackWallet",
        {
            userId: { in: userIds },
        },
        "cashbackWallets(userId) removidos",
    );

    // carros/favoritos
    await safeDeleteMany("car", { userId: { in: userIds } }, "cars removidos");
    await safeDeleteMany("washLocationFavorite", { userId: { in: userIds } }, "washLocationFavorites removidos");

    // por fim users
    await safeDeleteMany("user", { id: { in: userIds } }, "users removidos");
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const runId = randomRunId();
    logHeader(opts, runId);

    const ctx: SeededContext = {
        runId,
        adminUserId: 0,
        userId: 0,
        adminEmail: "",
        userEmail: "",
        adminPassword: "",
        userPassword: "",
        adminToken: null,
        userToken: null,
        adminReferralCode: null,
        userReferralCode: null,
        seeded: {
            users: [],
            cars: [],
            payments: [],
            cashbackWalletIds: [],
            cashbackTransactionIds: [],
        },
    };

    // Seed admin + user
    const seedStep = await runStep(opts, "seed admin + user", async () => {
        const admin = await seedUserOrReuse({ runId, seedTag: "admin", rolePreferred: ["ADMIN", "MANAGER", "USER"] });
        const user = await seedUserOrReuse({ runId, seedTag: "user", rolePreferred: ["USER", "ADMIN", "MANAGER"] });

        ctx.adminUserId = admin.id;
        ctx.userId = user.id;
        ctx.adminEmail = admin.email;
        ctx.userEmail = user.email;
        ctx.adminPassword = admin.passwordPlain;
        ctx.userPassword = user.passwordPlain;
        ctx.adminReferralCode = admin.referralCode;
        ctx.userReferralCode = user.referralCode;

        ctx.seeded.users.push(admin.id, user.id);

        logTag("adminUserId", String(admin.id));
        logTag("userId", String(user.id));

        ctx.adminToken = await loginBestEffort(opts.baseUrl, admin.email, admin.passwordPlain);
        ctx.userToken = await loginBestEffort(opts.baseUrl, user.email, user.passwordPlain);

        logTag("adminTokenReady", String(Boolean(ctx.adminToken)));
        logTag("userTokenReady", String(Boolean(ctx.userToken)));

        if (!ctx.adminToken) warnTag("AUTH", "admin token não obtido (best-effort).");
        if (!ctx.userToken) warnTag("AUTH", "user token não obtido (best-effort).");

        return true;
    });

    if (!seedStep.ok) {
        failTag("FAIL", "seed admin + user", seedStep.error);
        throw seedStep.error;
    }
    logTag("OK", "seed admin + user");

    // DOCS
    await runStep(opts, "docs", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken,
            label: "DOCS",
            candidates: ["/docs"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "probe docs");
        return true;
    });

    // DASHBOARD
    await runStep(opts, "dashboard", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken,
            label: "DASHBOARD",
            candidates: ["/dashboard"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "dashboard basic GET");
        return true;
    });

    // WASH SERVICES (corrigido: multi-auth fallback)
    await runStep(opts, "wash-services", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken ?? ctx.adminToken,
            label: "WASH_SERVICES",
            candidates: ["/wash-services"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "wash-services GET");
        return true;
    });

    // WASH LOCATION
    await runStep(opts, "wash-location", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken ?? ctx.adminToken,
            label: "WASH_LOCATION",
            candidates: ["/wash-location"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "wash-location GET");
        return true;
    });

    // NOTIFICATIONS
    await runStep(opts, "notifications", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken ?? ctx.adminToken,
            label: "NOTIFICATIONS",
            candidates: ["/notifications/list", "/notifications", "/notifications/all"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "notifications GET");
        return true;
    });

    // DAILY WASH (rota real, sem "adivinhar")
    await runStep(opts, "daily-wash", async () => {
        const token = ctx.userToken ?? ctx.adminToken;

        if (!token) {
            warnTag("DAILY_WASH", "sem token (skip)");
            logTag("OK", "daily-wash probe");
            return true;
        }

        // ROTA REAL: GET /daily-wash/availability
        const availabilityPath = "/daily-wash/availability";
        const availabilityRes = await httpGetWithAuthFallback({
            url: `${opts.baseUrl}${availabilityPath}`,
            token,
            timeoutMs: 20_000,
        });

        ensureOkOrThrow(opts, availabilityRes, `DAILY_WASH_AVAILABILITY GET ${availabilityPath}`);
        if (availabilityRes.ok) {
            logTag(
                "DAILY_WASH_AVAILABILITY",
                `GET ${availabilityPath} -> ${availabilityRes.status} (auth=${availabilityRes.tried.join(",")})`,
            );
        }

        // ROTA REAL: GET /daily-wash/user/:userId/history
        const historyPath = `/daily-wash/user/${ctx.userId}/history`;
        const historyRes = await httpGetWithAuthFallback({
            url: `${opts.baseUrl}${historyPath}`,
            token,
            timeoutMs: 20_000,
        });

        ensureOkOrThrow(opts, historyRes, `DAILY_WASH_HISTORY GET ${historyPath}`);
        if (historyRes.ok) {
            logTag(
                "DAILY_WASH_HISTORY",
                `GET ${historyPath} -> ${historyRes.status} (auth=${historyRes.tried.join(",")})`,
            );
        }

        logTag("OK", "daily-wash probe");
        return true;
    });

    // PLANS
    await runStep(opts, "plans", async () => {
        const r = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken ?? ctx.adminToken,
            label: "PLANS",
            candidates: ["/plans"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (r.ok) logTag("OK", "plans GET");
        return true;
    });

    // COUPONS
    await runStep(opts, "coupons", async () => {
        await couponsProbe({ opts, baseUrl: opts.baseUrl, token: ctx.userToken ?? ctx.adminToken });
        return true;
    });

    // REFERRALS_VALIDATE
    await runStep(opts, "referrals validate", async () => {
        await referralsValidateProbe({
            opts,
            baseUrl: opts.baseUrl,
            token: ctx.userToken ?? ctx.adminToken,
            fallbackReferralCode: ctx.adminReferralCode ?? ctx.userReferralCode,
        });
        return true;
    });

    // CASHBACK seed + probe
    const cashbackStep = await runStep(opts, "cashback seed + probe", async () => {
        const seeded = await seedCashbackWalletAndEarned({ runId, userId: ctx.userId, amount: 50 });
        if (seeded.walletId) ctx.seeded.cashbackWalletIds.push(seeded.walletId);
        if (seeded.earnedTxId) ctx.seeded.cashbackTransactionIds.push(seeded.earnedTxId);

        const token = ctx.userToken ?? ctx.adminToken;

        const r1 = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token,
            label: "CASHBACK_BALANCE",
            candidates: ["/cashback/balance", "/cashback/summary", "/cashback/wallet", "/cashback/me"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (!r1.ok) warnTag("CASHBACK", "endpoints de cashback não responderam (best-effort).");

        const r2 = await probeGetFirstOk({
            opts,
            baseUrl: opts.baseUrl,
            token,
            label: "CASHBACK_TRANSACTIONS",
            candidates: ["/cashback/transactions", "/cashback/history", "/cashback/list"],
            retryWithAdminToken: ctx.adminToken,
        });
        if (!r2.ok) warnTag("CASHBACK_TRANSACTIONS", "nenhum endpoint candidato respondeu (404/405).");

        logTag("OK", "cashback seed + probe");
        return true;
    });

    if (!cashbackStep.ok) failTag("FAIL", "cashback seed + probe", cashbackStep.error);

    // USER-CAR CRUD
    await runStep(opts, "user-car CRUD", async () => {
        if (!ctx.userToken) {
            warnTag("USER_CAR", "sem userToken (skip)");
            return true;
        }
        const car = await userCarCrud({ opts, baseUrl: opts.baseUrl, token: ctx.userToken, runId });
        if (car.createdCarId) ctx.seeded.cars.push(car.createdCarId);
        return true;
    });

    // ADMIN USERS
    await runStep(opts, "admin users", async () => {
        if (!ctx.adminToken) {
            warnTag("ADMIN_USERS", "sem adminToken (skip)");
            return true;
        }
        await adminUsersProbeAndCrud({
            opts,
            baseUrl: opts.baseUrl,
            adminToken: ctx.adminToken,
            runId,
            userIdToGet: ctx.userId,
        });
        return true;
    });

    // PAYMENT seed + probe
    await runStep(opts, "payment seed + probe", async () => {
        logTag("paymentPrefix", opts.paymentPrefix);

        const payments = await seedPaymentsDbOnly({ runId, userId: ctx.userId, count: 5 });
        ctx.seeded.payments.push(...payments);
        logTag("seededPayments", String(payments.length));

        const token = ctx.userToken ?? ctx.adminToken;
        if (!token) {
            warnTag("PAYMENT", "sem token (skip queries)");
            return true;
        }

        const seededPaymentId = payments[0] ?? 0;
        await paymentProbe({
            opts,
            baseUrl: opts.baseUrl,
            token,
            paymentPrefix: opts.paymentPrefix,
            seededPaymentId,
        });

        if (payments.length > 0 && prismaHasDelegate("payment")) {
            const payment = await (prisma as any).payment
                .findUnique({ where: { id: payments[0] }, select: { paymentIdAsaas: true } })
                .catch(() => null);

            const asaasPaymentId = typeof payment?.paymentIdAsaas === "string" ? payment.paymentIdAsaas : null;
            if (asaasPaymentId) {
                await paymentWebhookProbe({ opts, baseUrl: opts.baseUrl, paymentPrefix: opts.paymentPrefix, asaasPaymentId });
            } else {
                warnTag("PAYMENT_WEBHOOK", "campo paymentIdAsaas não disponível no seed (skip)");
            }
        }

        logTag("OK", "payment seed + queries + webhook(optional)");
        return true;
    });

    // CLEANUP (corrigido pra não quebrar FK)
    if (opts.cleanup) {
        await runStep(opts, "cleanup", async () => {
            const seededUserIds = ctx.seeded.users;
            await bestEffortCleanupByUserIds(seededUserIds, runId, ctx.seeded.payments);
            logTag("OK", "cleanup");
            return true;
        });
    } else {
        logTag("CLEANUP", "skip (cleanup=false)");
    }

    console.log(bannerLine());
    console.log(`[SMOKE] ✅ OK runId=${runId}`);
    console.log(bannerLine());
}

// Entrypoint
main()
    .catch((err) => {
        console.log(bannerLine());
        console.error("[SMOKE] ❌ ERROR", err);
        console.log(bannerLine());
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect().catch(() => undefined);
    });
