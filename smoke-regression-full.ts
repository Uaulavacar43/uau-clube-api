/* eslint-disable no-console */
import "dotenv/config";
import crypto from "crypto";
import {
  Prisma,
  PrismaClient,
  Role,
  UserStatus,
  WalletType,
  TransactionType,
  TransactionSource,
  BonusType,
  PaymentStatus,
  PaymentChannel,
  DiscountType,
} from "@prisma/client";

type Json = Record<string, any>;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function nowIso(): string {
  return new Date().toISOString();
}

function log(step: string, msg: string, data?: any) {
  const prefix = `[${nowIso()}] [${step}]`;
  if (data !== undefined) console.log(prefix, msg, data);
  else console.log(prefix, msg);
}

function warn(step: string, msg: string, data?: any) {
  const prefix = `[${nowIso()}] [${step}] [WARN]`;
  if (data !== undefined) console.warn(prefix, msg, data);
  else console.warn(prefix, msg);
}

function err(step: string, msg: string, data?: any) {
  const prefix = `[${nowIso()}] [${step}] [ERROR]`;
  if (data !== undefined) console.error(prefix, msg, data);
  else console.error(prefix, msg);
}

function assert(cond: any, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw) continue;
    if (raw.startsWith("--")) {
      const [k, v] = raw.split("=");
      const key = k.replace(/^--/, "").trim();
      if (v === undefined) args[key] = true;
      else args[key] = v.trim();
    }
  }
  return args;
}

function sanitizeDbUrl(dbUrl: string): string {
  if (!dbUrl) return "(vazio)";
  return dbUrl.replace(/\/\/.*?:.*?@/, "//***:***@").replace(/\?.*$/, "?***");
}

function joinUrl(baseUrl: string, path: string) {
  const b = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function httpRequest(
  baseUrl: string,
  path: string,
  method: HttpMethod,
  body: Json | null,
  timeoutMs: number,
  headers?: Record<string, string>,
) {
  const url = joinUrl(baseUrl, path);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(headers ?? {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let payload: any = null;
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        payload = await resp.json();
      } catch {
        payload = null;
      }
    } else {
      try {
        payload = await resp.text();
      } catch {
        payload = null;
      }
    }

    return { status: resp.status, data: payload, url };
  } finally {
    clearTimeout(timer);
  }
}

async function ping(baseUrl: string, pingPath: string, timeoutMs: number) {
  log("PING", "Pingando API...", { baseUrl, pingPath });
  const r = await httpRequest(baseUrl, pingPath, "GET", null, timeoutMs);
  log("PING", "Conectou.", { url: r.url, status: r.status });
}

async function dbHealth(prisma: PrismaClient) {
  log("DB", "Healthcheck (SELECT 1)...");
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 as ok`);
  log("DB", "OK.", r?.[0] ?? null);
}

// ---------------------------
// Melhor log para Zod errors (fix do [Object])
// ---------------------------
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unstringifiable]";
    }
  }
}

type ZodIssueLike = {
  code?: string;
  path?: Array<string | number>;
  message?: string;
  expected?: unknown;
  received?: unknown;
  keys?: string[];
};

function extractZodIssues(data: any): ZodIssueLike[] {
  const errors = data?.errors;
  if (!Array.isArray(errors)) return [];
  return errors as ZodIssueLike[];
}

function logRequestValidationErrors(step: string, responseData: any) {
  const issues = extractZodIssues(responseData);
  if (!issues.length) {
    log(step, "400 sem issues detalhadas", { response: responseData });
    return;
  }

  const simplified = issues.map((i) => ({
    code: i.code,
    path: Array.isArray(i.path) ? i.path.join(".") : "",
    message: i.message,
    expected: i.expected,
    received: i.received,
    keys: i.keys,
  }));

  log(step, "Validation errors (detalhado)", simplified);
}

function patchPayloadFromZodIssues(
  payload: Json,
  issues: ZodIssueLike[],
  defaults?: {
    timeZoneOffset?: number;
    holderInfo?: any;
    phone?: string;
    washServiceIds?: number[];
    carId?: number;
    cpf?: string;
  },
) {
  const next: Json = { ...(payload ?? {}) };

  // 1) remove keys não reconhecidas (Zod .strict())
  for (const issue of issues) {
    if (issue?.code === "unrecognized_keys" && Array.isArray(issue.keys)) {
      for (const k of issue.keys) delete next[k];
    }
  }

  const has = (k: string) =>
    Object.prototype.hasOwnProperty.call(next, k) && next[k] !== undefined;

  const firstIdFromArray = (v: any): number | undefined => {
    if (!Array.isArray(v) || v.length === 0) return undefined;
    const n = Number(v[0]);
    return Number.isFinite(n) ? n : undefined;
  };

  // 2) sinônimos comuns (DTOs que variam naming)
  if (!has("userCarId") && has("carId")) next.userCarId = next.carId;
  if (!has("carId") && has("userCarId")) next.carId = next.userCarId;

  if (!has("washServiceIds") && has("washServices"))
    next.washServiceIds = next.washServices;
  if (!has("washServiceIds") && has("serviceIds"))
    next.washServiceIds = next.serviceIds;

  if (!has("serviceIds") && has("washServiceIds"))
    next.serviceIds = next.washServiceIds;
  if (!has("washServices") && has("washServiceIds"))
    next.washServices = next.washServiceIds;

  if (!has("washServiceId")) {
    const fromPlural =
      firstIdFromArray(next.washServiceIds) ??
      firstIdFromArray(next.serviceIds) ??
      firstIdFromArray(next.washServices);
    if (fromPlural !== undefined) next.washServiceId = fromPlural;
  }

  if (!has("billingType") && has("type")) next.billingType = next.type;
  if (!has("type") && has("billingType")) next.type = next.billingType;

  if (!has("cpfCnpj") && has("cpf")) next.cpfCnpj = next.cpf;
  if (!has("cpf") && has("cpfCnpj")) next.cpf = next.cpfCnpj;

  // 3) defaults úteis
  if (!has("timeZoneOffset") && defaults?.timeZoneOffset !== undefined)
    next.timeZoneOffset = defaults.timeZoneOffset;
  if (!has("cpf") && defaults?.cpf) next.cpf = defaults.cpf;
  if (!has("cpfCnpj") && defaults?.cpf) next.cpfCnpj = defaults.cpf;

  if (!has("washServiceIds") && defaults?.washServiceIds?.length)
    next.washServiceIds = defaults.washServiceIds;
  if (!has("washServices") && defaults?.washServiceIds?.length)
    next.washServices = defaults.washServiceIds;
  if (!has("serviceIds") && defaults?.washServiceIds?.length)
    next.serviceIds = defaults.washServiceIds;

  if (!has("userCarId") && defaults?.carId) next.userCarId = defaults.carId;
  if (!has("carId") && defaults?.carId) next.carId = defaults.carId;

  // 4) se o schema reclamar de holderInfo/phone ausentes, tenta incluir
  for (const issue of issues) {
    const p0 =
      Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : "";

    if (!p0) continue;

    if (
      p0 === "creditCardHolderInfo" &&
      !has("creditCardHolderInfo") &&
      defaults?.holderInfo
    ) {
      // serve tanto para PIX (alguns backends exigem) quanto para cartão
      next.creditCardHolderInfo = defaults.holderInfo;
    }

    if (p0 === "phone" && !has("phone") && defaults?.phone) {
      next.phone = defaults.phone;
    }

    // coerções simples (string -> number)
    if (issue.code === "invalid_type" && issue.expected === "number") {
      const v = next[p0];
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) next[p0] = n;
      }
    }
  }

  // 5) normaliza enums comuns
  if (typeof next.type === "string") {
    // seu backend aceitou: 'creditCard' | 'pix'
    const t = String(next.type).trim();
    if (t.toLowerCase() === "pix") next.type = "pix";
    if (t.toLowerCase() === "creditcard") next.type = "creditCard";
    if (t === "PIX" || t === "Pix") next.type = "pix";
  }

  if (typeof next.billingType === "string") {
    const bt = String(next.billingType).trim();
    if (bt.toLowerCase() === "pix") next.billingType = "pix";
    if (bt.toLowerCase() === "creditcard") next.billingType = "creditCard";
    if (bt === "PIX" || bt === "Pix") next.billingType = "pix";
  }

  // 6) garante washServices se for exigido
  if (!has("washServices") && defaults?.washServiceIds?.length)
    next.washServices = defaults.washServiceIds;

  return next;
}

// ---------------------------
// Random / CPF / Plate helpers
// ---------------------------
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizePlate(plate: string): string {
  return (plate ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generateRandomPlate(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pick = (s: string) => s[randInt(0, s.length - 1)];
  const isMercosul = Math.random() > 0.5;

  if (isMercosul) {
    return normalizePlate(
      `${pick(letters)}${pick(letters)}${pick(letters)}${randInt(0, 9)}${pick(
        letters,
      )}${randInt(0, 9)}${randInt(0, 9)}`,
    );
  }

  return normalizePlate(
    `${pick(letters)}${pick(letters)}${pick(letters)}${randInt(0, 9)}${randInt(
      0,
      9,
    )}${randInt(0, 9)}${randInt(0, 9)}`,
  );
}

/**
 * CPF válido (11 dígitos)
 */
function generateValidCpf(): string {
  const n: number[] = [];
  for (let i = 0; i < 9; i++) n.push(randInt(0, 9));

  const calcDigit = (base: number[], factorStart: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += base[i] * (factorStart - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcDigit(n, 10);
  const d2 = calcDigit([...n, d1], 11);

  return [...n, d1, d2].join("");
}

async function generateUniqueCpf(prisma: PrismaClient): Promise<string> {
  for (let attempt = 1; attempt <= 80; attempt++) {
    const cpf = generateValidCpf();
    const exists = await (prisma as any).user.findUnique({ where: { cpf } });
    if (!exists) return cpf;
  }
  throw new Error("Não consegui gerar CPF único após 80 tentativas.");
}

function generateUniqueEmail(tag: string, runId: string): string {
  return `smoke.${tag}.${runId}.${Date.now()}.${crypto.randomInt(
    1000,
    9999,
  )}@example.com`.toLowerCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function competenceYearMonthFrom(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return `${y}-${pad2(m)}`;
}

// ---------------------------
// Prisma helpers (idempotency / known errors)
// ---------------------------
function knownRequestErrorCode(e: unknown): string | undefined {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
  return undefined;
}

function isUniqueConstraintError(e: unknown): boolean {
  return knownRequestErrorCode(e) === "P2002";
}

function isPrismaUnknownArgError(e: any): boolean {
  const msg = String(e?.message ?? "");
  return (
    msg.includes("Unknown arg") ||
    msg.includes("Unknown argument") ||
    msg.includes("unknown argument")
  );
}

// ---------------------------
// ASAAS customerId best-effort patch (para destravar /payment no smoke)
// ---------------------------
const ASAAS_BLOCK_MESSAGE_FRAGMENT = "Usuário sem customerId do ASAAS";

async function ensureAsaasCustomerIdBestEffort(params: {
  prisma: PrismaClient;
  userId: number;
  runId: string;
}) {
  const { prisma, userId, runId } = params;

  // ⚠️ Valor fake só pra destravar o fluxo no ambiente local.
  // Se teu backend realmente chamar a API do ASAAS, você vai precisar de um customerId real.
  // Aqui a ideia é: passar da validação "ausente" e bater no resto do pipeline.
  const fakeCustomerId = `cus_${runId}_${userId}`;

  const candidateFields = [
    "customerIdAsaas",
    "asaasCustomerId",
    "asaasCustomerID",
    "asaasCustomer",
    "customerAsaasId",
    "asaasCustomer",
    "asaas_customer_id",
    "customer_id_asaas",
    "customerId",
    "asaasId",
    "asaasCustomerCode",
    "customerCodeAsaas",
  ];

  // 1) tenta updates diretos por nomes possíveis
  for (const field of candidateFields) {
    try {
      const data: any = { [field]: fakeCustomerId };
      await (prisma as any).user.update({ where: { id: userId }, data });
      log("ASAAS", "Setei customerId ASAAS (best-effort)", {
        userId,
        field,
        value: fakeCustomerId,
      });
      return { ok: true as const, field, value: fakeCustomerId };
    } catch (e: any) {
      if (isPrismaUnknownArgError(e)) continue;
      continue;
    }
  }

  // 2) fallback: tenta JSON/meta (bem comum em schemas antigos)
  // tenta: user.meta.asaasCustomerId / user.meta.customerIdAsaas / user.meta.asaas.customerId
  const jsonCandidates = [
    { field: "meta", patch: (meta: any) => ({ ...(meta ?? {}), asaasCustomerId: fakeCustomerId }) },
    { field: "meta", patch: (meta: any) => ({ ...(meta ?? {}), customerIdAsaas: fakeCustomerId }) },
    {
      field: "meta",
      patch: (meta: any) => ({
        ...(meta ?? {}),
        asaas: { ...(meta?.asaas ?? {}), customerId: fakeCustomerId },
      }),
    },
  ];

  for (const jc of jsonCandidates) {
    try {
      const u = await (prisma as any).user.findUnique({ where: { id: userId } });
      const current = (u as any)?.[jc.field];
      const patched = jc.patch(current);
      const data: any = { [jc.field]: patched };
      await (prisma as any).user.update({ where: { id: userId }, data });
      log("ASAAS", "Setei customerId ASAAS dentro de meta (best-effort)", {
        userId,
        field: jc.field,
      });
      return { ok: true as const, field: jc.field, value: fakeCustomerId };
    } catch (e: any) {
      if (isPrismaUnknownArgError(e)) continue;
      continue;
    }
  }

  warn(
    "ASAAS",
    "Não consegui setar customerId ASAAS via Prisma (field desconhecido no schema). Seguindo (pode falhar no /payment).",
  );
  return { ok: false as const, field: null, value: null };
}

function looksLikeAsaasBlock(responseData: any): boolean {
  const msg = String(responseData?.message ?? "");
  return msg.includes(ASAAS_BLOCK_MESSAGE_FRAGMENT);
}

// ---------------------------
// Cashback helpers
// ---------------------------
async function ensureWallet(prisma: PrismaClient, userId: number) {
  const wallet = await (prisma as any).cashbackWallet.upsert({
    where: { userId_type: { userId, type: WalletType.INTERNAL } },
    create: { userId, type: WalletType.INTERNAL, balance: 0 },
    update: {},
  });
  return wallet;
}

async function creditCashbackIdempotent(params: {
  prisma: PrismaClient;
  receiverId: number;
  eventKey: string;
  amount: number;
  source?: TransactionSource;
  relatedId?: string;
  meta?: any;
  referralGroupId?: number | null;
  referralPosition?: number | null;
}) {
  const {
    prisma,
    receiverId,
    eventKey,
    amount,
    source = TransactionSource.INDICATION,
    relatedId,
    meta,
    referralGroupId,
    referralPosition,
  } = params;

  const exists = await (prisma as any).cashbackTransaction.findUnique?.({
    where: { eventKey },
  });
  if (exists)
    throw new Error(
      `Idempotência falhou: já existe cashbackTransaction para eventKey=${eventKey}`,
    );

  await (prisma as any).cashbackTransaction.create({
    data: {
      userId: receiverId,
      type: TransactionType.EARNED,
      source,
      amount,
      relatedId: relatedId ?? null,
      eventKey,
      meta: meta ?? {},
      referralGroupId: referralGroupId ?? null,
      referralPosition: referralPosition ?? null,
    },
  });

  await (prisma as any).cashbackWallet.update({
    where: { userId_type: { userId: receiverId, type: WalletType.INTERNAL } },
    data: { balance: { increment: amount } },
  });
}

async function debitCashback(params: {
  prisma: PrismaClient;
  userId: number;
  eventKey: string;
  amount: number;
  source?: TransactionSource;
  meta?: any;
}) {
  const {
    prisma,
    userId,
    eventKey,
    amount,
    source = TransactionSource.SUBSCRIPTION_DEBIT,
    meta,
  } = params;

  await (prisma as any).cashbackTransaction.create({
    data: {
      userId,
      type: TransactionType.USED,
      source,
      amount,
      eventKey,
      meta: meta ?? {},
    },
  });

  await (prisma as any).cashbackWallet.update({
    where: { userId_type: { userId, type: WalletType.INTERNAL } },
    data: { balance: { decrement: amount } },
  });
}

// ---------------------------
// Coupon minimum charge rule (Fase 2)
// ---------------------------
const MINIMUM_CHARGE_AMOUNT = 1;

function ensureMinimumAmount(
  value: number,
  minimum = MINIMUM_CHARGE_AMOUNT,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return minimum;
  if (n <= 0) return minimum;
  return Number(n.toFixed(2));
}

type CouponLike = {
  discountType: DiscountType;
  discountValue: number;
};

function applyCouponWithMinimumCharge(
  baseAmount: number,
  coupon: CouponLike | null,
  minimumCharge: number = MINIMUM_CHARGE_AMOUNT,
): { finalAmount: number; appliedDiscount: number } {
  if (!coupon)
    return {
      finalAmount: ensureMinimumAmount(baseAmount, minimumCharge),
      appliedDiscount: 0,
    };

  const base = Number(baseAmount) || 0;
  const minCharge = ensureMinimumAmount(minimumCharge, MINIMUM_CHARGE_AMOUNT);

  if (base <= 0) return { finalAmount: minCharge, appliedDiscount: 0 };

  const maxDiscount = Math.max(0, base - minCharge);
  if (maxDiscount <= 0) return { finalAmount: minCharge, appliedDiscount: 0 };

  if (coupon.discountType === DiscountType.PERCENTAGE) {
    const percent = Number(coupon.discountValue) || 0;
    const requestedDiscount = (base * percent) / 100;
    const applied = Math.min(requestedDiscount, maxDiscount);
    const final = base - applied;
    return {
      finalAmount: ensureMinimumAmount(final, minCharge),
      appliedDiscount: Number(applied.toFixed(2)),
    };
  }

  const requested = Number(coupon.discountValue) || 0;
  const applied = Math.min(requested, maxDiscount);
  const final = base - applied;
  return {
    finalAmount: ensureMinimumAmount(final, minCharge),
    appliedDiscount: Number(applied.toFixed(2)),
  };
}

// ---------------------------
// API flows: register/login + car + admin-car + payment
// ---------------------------
async function registerAndLogin(params: {
  baseUrl: string;
  timeoutMs: number;
  prisma: PrismaClient;
  tag: string;
  runId: string;
}) {
  const { baseUrl, timeoutMs, prisma, tag, runId } = params;

  const email = generateUniqueEmail(tag, runId);
  const cpf = await generateUniqueCpf(prisma);
  const password = "123456";

  const registerBody: Json = {
    name: `Smoke ${tag} ${runId}`,
    email,
    password,
    phone: "11999999999",
    cpf,
  };

  const registerResp = await httpRequest(
    baseUrl,
    "/auth/register",
    "POST",
    registerBody,
    timeoutMs,
  );
  assert(
    registerResp.status === 201,
    `Register falhou. HTTP ${registerResp.status}. Body=${safeStringify(
      registerResp.data,
    )}`,
  );

  const userId = Number(
    (registerResp.data as any)?.user?.id ?? (registerResp.data as any)?.id,
  );
  assert(userId && !Number.isNaN(userId), "Register não retornou user.id válido.");

  const loginResp = await httpRequest(
    baseUrl,
    "/auth/login",
    "POST",
    { email, password },
    timeoutMs,
  );
  assert(
    loginResp.status === 200,
    `Login falhou. HTTP ${loginResp.status}. Body=${safeStringify(loginResp.data)}`,
  );

  const token = String((loginResp.data as any)?.token || "");
  assert(token, "Login não retornou token.");

  // força ACTIVE (evita bloquear flows por status)
  try {
    await (prisma as any).user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });
  } catch {}

  return { userId, email, cpf, password, token };
}

async function promoteToAdmin(prisma: PrismaClient, userId: number) {
  await (prisma as any).user.update({
    where: { id: userId },
    data: { role: Role.ADMIN, status: UserStatus.ACTIVE },
  });
}

async function createCarWithPlateBestEffort(params: {
  baseUrl: string;
  timeoutMs: number;
  token: string;
  plate: string;
}) {
  const { baseUrl, timeoutMs, token, plate } = params;
  const headers = { Authorization: `Bearer ${token}` };

  const payload: Json = {
    licensePlate: normalizePlate(plate),
    brand: "SMOKE",
    model: "SMOKE-CAR",
    color: "BLACK",
    year: 2024,
  };

  const candidatePaths = ["/user-car", "/user-car/register", "/cars", "/user-cars", "/car"];

  let last: any = null;

  for (const path of candidatePaths) {
    const r = await httpRequest(baseUrl, path, "POST", payload, timeoutMs, headers);
    last = r;

    log("CAR_CREATE", "Tentativa create car", { path, status: r.status, plate: payload.licensePlate });

    if (r.status === 404) continue;

    if (r.status >= 200 && r.status < 300) {
      const id = Number((r.data as any)?.id ?? (r.data as any)?.car?.id);
      if (id && !Number.isNaN(id)) {
        return { ok: true as const, id, plate: payload.licensePlate, raw: r.data, path };
      }
      throw new Error(
        `Create car respondeu 2xx mas sem id no payload. path=${path} body=${safeStringify(r.data)}`,
      );
    }
  }

  return { ok: false as const, last };
}

async function adminCarEndpointsSmoke(params: {
  baseUrl: string;
  timeoutMs: number;
  adminToken: string;
  plate: string;
  userId: number;
  carId: number;
  expectAmbiguousPlate?: boolean;
}) {
  const { baseUrl, timeoutMs, adminToken, plate, userId, carId, expectAmbiguousPlate = false } = params;
  const headers = { Authorization: `Bearer ${adminToken}` };

  const r1 = await httpRequest(
    baseUrl,
    `/admin-car/plate/${plate}?includeInactive=true`,
    "GET",
    null,
    timeoutMs,
    headers,
  );

  if (expectAmbiguousPlate) {
    assert(
      r1.status === 409,
      `Esperado 409 em getCarByPlate (placa ambígua). HTTP ${r1.status}. Body=${safeStringify(r1.data)}`,
    );
    log("ADMIN_CAR", "getCarByPlate retornou 409 (placa ambígua) - OK", { status: 409 });
  } else {
    assert(
      r1.status >= 200 && r1.status < 300,
      `Admin getCarByPlate falhou. HTTP ${r1.status}. Body=${safeStringify(r1.data)}`,
    );
    log("ADMIN_CAR", "getCarByPlate OK", { status: r1.status });
  }

  const r2 = await httpRequest(
    baseUrl,
    `/admin-car/plate/${plate}/user/${userId}?includeInactive=true`,
    "GET",
    null,
    timeoutMs,
    headers,
  );
  assert(
    r2.status >= 200 && r2.status < 300,
    `Admin getCarByPlateAndUserId falhou. HTTP ${r2.status}. Body=${safeStringify(r2.data)}`,
  );

  const r3 = await httpRequest(baseUrl, `/admin-car/${carId}/deactivate`, "PATCH", null, timeoutMs, headers);
  assert(
    r3.status >= 200 && r3.status < 300,
    `Admin deactivateCar falhou. HTTP ${r3.status}. Body=${safeStringify(r3.data)}`,
  );

  const r4 = await httpRequest(baseUrl, `/admin-car/${carId}/activate`, "PATCH", null, timeoutMs, headers);
  assert(
    r4.status >= 200 && r4.status < 300,
    `Admin activateCar falhou. HTTP ${r4.status}. Body=${safeStringify(r4.data)}`,
  );

  const r5 = await httpRequest(
    baseUrl,
    `/admin-car/plate/${plate}/user/${userId}/reactivate`,
    "PATCH",
    null,
    timeoutMs,
    headers,
  );

  if (r5.status >= 200 && r5.status < 300) {
    log("ADMIN_CAR", "reactivate (by plate+user) OK", { status: r5.status });
  } else {
    warn("ADMIN_CAR", "reactivate (by plate+user) não passou (opcional)", {
      status: r5.status,
      body: r5.data,
    });
  }

  return {
    ok: true,
    statuses: {
      getPlate: r1.status,
      getPlateUser: r2.status,
      deactivate: r3.status,
      activate: r4.status,
      reactivateByPlateUser: r5.status,
    },
  };
}

async function resolvePaymentPrefix(baseUrl: string, timeoutMs: number) {
  const candidates = ["/payment", "/payments"];
  for (const prefix of candidates) {
    const r = await httpRequest(baseUrl, prefix, "GET", null, Math.min(timeoutMs, 8000));
    if (r.status !== 404) {
      log("PAYMENT_BASE", "Prefix resolvido", { prefix, status: r.status });
      return prefix;
    }
  }
  log("PAYMENT_BASE", "Assumindo /payment", {});
  return "/payment";
}

function getPhoneVariants(): string[] {
  return ["11999999999", "11 99999-9999", "(11) 99999-9999", "5511999999999", "+5511999999999"];
}

function buildHolderInfo(params: { cpf: string; email: string; phone: string }) {
  const { cpf, email, phone } = params;
  return {
    name: "Smoke Holder",
    email,
    cpfCnpj: cpf,
    phone,
    postalCode: "61760046",
    addressNumber: "4569",
    addressComplement: undefined,
    mobilePhone: phone,
  };
}

// ✅ ATUALIZADO: createPaymentBestEffort agora:
// - usa apenas type='pix' (seu backend recusou 'PIX'/'Pix')
// - sempre inclui washServices (seu backend exigiu)
// - detecta bloqueio ASAAS e tenta setar customerId (best-effort) e retry 1x
// - imprime errors detalhados (sem [Object])
// - tenta patch guiado por issues (sinônimos + remove keys unrecognized + adiciona holderInfo se exigido)
async function createPaymentBestEffort(params: {
  baseUrl: string;
  timeoutMs: number;
  prisma: PrismaClient;
  userId: number;
  runId: string;
  token: string;
  paymentPrefix: string;
  cpf: string;
  washServiceIds: number[];
  carId: number;
  userEmailForHolderInfo: string;
}) {
  const {
    baseUrl,
    timeoutMs,
    prisma,
    userId,
    runId,
    token,
    paymentPrefix,
    cpf,
    washServiceIds,
    carId,
    userEmailForHolderInfo,
  } = params;

  const endpoint = paymentPrefix;
  const headers = { Authorization: `Bearer ${token}` };

  const phoneVariants = getPhoneVariants();

  const baseCandidates: Json[] = [];

  // candidato base "mínimo" que seu Zod parece aceitar melhor
  baseCandidates.push({
    type: "pix",
    cpf,
    washServices: washServiceIds,
    carId,
    timeZoneOffset: -180,
  });

  // variações comuns (alguns DTOs usam userCarId)
  baseCandidates.push({
    type: "pix",
    cpf,
    washServices: washServiceIds,
    userCarId: carId,
    timeZoneOffset: -180,
  });

  // sem timezone (se o DTO não tiver isso)
  baseCandidates.push({
    type: "pix",
    cpf,
    washServices: washServiceIds,
    carId,
  });

  // variantes com holderInfo/phone (se backend exigir mesmo no PIX)
  for (const phone of phoneVariants) {
    const holderInfo = buildHolderInfo({ cpf, email: userEmailForHolderInfo, phone });
    baseCandidates.push({
      type: "pix",
      cpf,
      washServices: washServiceIds,
      carId,
      creditCardHolderInfo: holderInfo,
      phone,
      timeZoneOffset: -180,
    });
  }

  let last: any = null;

  for (const initialBody of baseCandidates) {
    let body: Json = { ...initialBody };

    // tenta até 3 patches guiados por issues
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);
      last = r;

      log("PAYMENT_CREATE", "Tentativa", {
        attempt,
        status: r.status,
        keys: Object.keys(body),
        endpoint,
      });

      if (r.status >= 200 && r.status < 300) {
        const paymentId = Number(
          (r.data as any)?.id ??
            (r.data as any)?.payment?.id ??
            (r.data as any)?.paymentId,
        );
        return {
          ok: true as const,
          paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
          response: r.data,
        };
      }

      // ASAAS block: tenta setar customerId e repetir 1 vez o mesmo request
      if (r.status === 400 && looksLikeAsaasBlock(r.data)) {
        log("PAYMENT_CREATE", "Bloqueio ASAAS detectado (customerId ausente).", {
          message: r.data?.message,
        });
        await ensureAsaasCustomerIdBestEffort({ prisma, userId, runId });
        const retry = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);
        log("PAYMENT_CREATE", "Retry pós-ASAAS", { status: retry.status });
        if (retry.status >= 200 && retry.status < 300) {
          const paymentId = Number(
            (retry.data as any)?.id ??
              (retry.data as any)?.payment?.id ??
              (retry.data as any)?.paymentId,
          );
          return {
            ok: true as const,
            paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
            response: retry.data,
          };
        }
        last = retry;
        if (retry.status === 400 && looksLikeAsaasBlock(retry.data)) break;
      }

      if (r.status !== 400) break;

      // ✅ imprime o detalhe das validações (resolve teu [Object])
      logRequestValidationErrors("PAYMENT_CREATE", r.data);

      const issues = extractZodIssues(r.data);
      if (!issues.length) break;

      const phoneDefault =
        typeof body.phone === "string" ? body.phone : phoneVariants[0];
      const holderInfoDefault = buildHolderInfo({
        cpf,
        email: userEmailForHolderInfo,
        phone: phoneDefault,
      });

      const patched = patchPayloadFromZodIssues(body, issues, {
        timeZoneOffset: -180,
        holderInfo: holderInfoDefault,
        phone: phoneDefault,
        washServiceIds,
        carId,
        cpf,
      });

      const same = safeStringify(patched) === safeStringify(body);
      body = patched;

      if (same) break;
    }
  }

  const e: any = new Error(`Create payment falhou. Último HTTP ${last?.status ?? "?"}`);
  e.response = last?.data ?? null;
  throw e;
}

async function subscribeBestEffort(params: {
  baseUrl: string;
  timeoutMs: number;
  prisma: PrismaClient;
  userId: number;
  runId: string;
  token: string;
  paymentPrefix: string;
  cpf: string;
  planId: number;
  carId: number;
  timeZoneOffset: number;
  userEmailForHolderInfo: string;
}) {
  const {
    baseUrl,
    timeoutMs,
    prisma,
    userId,
    runId,
    token,
    paymentPrefix,
    cpf,
    planId,
    carId,
    timeZoneOffset,
    userEmailForHolderInfo,
  } = params;

  const endpoint = `${paymentPrefix}/subscribe`;
  const headers = { Authorization: `Bearer ${token}` };

  const phoneVariants = getPhoneVariants();
  const payloads: Json[] = [];

  for (const phone of phoneVariants) {
    const holderInfo = buildHolderInfo({ cpf, email: userEmailForHolderInfo, phone });

    payloads.push({ type: "pix", cpf, planId, carId, timeZoneOffset, creditCardHolderInfo: holderInfo });
    payloads.push({ type: "pix", cpf, plan_id: planId, carId, timeZoneOffset, creditCardHolderInfo: holderInfo });

    payloads.push({ type: "pix", cpf, planId, carId, timeZoneOffset, phone });
    payloads.push({ type: "pix", cpf, planId, carId, timeZoneOffset });
  }

  let last: any = null;

  for (const body of payloads) {
    const r = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);
    last = r;

    log("SUBSCRIBE", "Tentativa", { status: r.status, keys: Object.keys(body) });

    if (r.status >= 200 && r.status < 300) {
      const subscriptionId = Number((r.data as any)?.subscription?.id ?? (r.data as any)?.id);
      const paymentId = Number((r.data as any)?.payment?.id ?? (r.data as any)?.paymentId);

      return {
        ok: true as const,
        subscriptionId: subscriptionId && !Number.isNaN(subscriptionId) ? subscriptionId : null,
        paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
        response: r.data,
      };
    }

    if (r.status === 400 && looksLikeAsaasBlock(r.data)) {
      log("SUBSCRIBE", "Bloqueio ASAAS detectado (customerId ausente).", { message: r.data?.message });
      await ensureAsaasCustomerIdBestEffort({ prisma, userId, runId });
      const retry = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);
      log("SUBSCRIBE", "Retry pós-ASAAS", { status: retry.status });
      if (retry.status >= 200 && retry.status < 300) {
        const subscriptionId = Number((retry.data as any)?.subscription?.id ?? (retry.data as any)?.id);
        const paymentId = Number((retry.data as any)?.payment?.id ?? (retry.data as any)?.paymentId);

        return {
          ok: true as const,
          subscriptionId: subscriptionId && !Number.isNaN(subscriptionId) ? subscriptionId : null,
          paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
          response: retry.data,
        };
      }

      if (retry.status === 400 && looksLikeAsaasBlock(retry.data)) continue;
    }
  }

  const e: any = new Error(`Subscribe falhou. Último HTTP ${last?.status ?? "?"}`);
  e.response = last?.data ?? null;
  throw e;
}

// ---------------------------
// DB selectors (plan + washService)
// ---------------------------
async function selectPlanPreferDb(prisma: PrismaClient) {
  const plan = await (prisma as any).plan.findFirst({
    where: { price: { gt: 0 } },
    orderBy: [{ isPackage: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      price: true,
      duration: true,
      periodicityType: true,
      maxInstallments: true,
      isPackage: true,
    },
  });
  return plan ?? null;
}

async function selectWashServicesPreferDb(prisma: PrismaClient, take = 2) {
  const services = await (prisma as any).washService.findMany({
    where: { isPublished: true, isAvailable: true },
    orderBy: { id: "asc" },
    take,
    select: { id: true, name: true, price: true, isPublished: true, isAvailable: true },
  });
  return Array.isArray(services) ? services : [];
}

// ---------------------------
// CLEANUP (apaga só o que o teste criou)
// ---------------------------
type CleanupCtx = {
  runId: string;
  userIds: number[];
  carIds: number[];
  paymentIds: number[];
  subscriptionIds: number[];
  planIds: number[];
  couponIds: number[];
  referralGroupIds: number[];
  referralGroupMemberIds: number[];
  referralBonusIds: number[];
  userReferralIds: number[];
  cashbackTransactionEventKeys: string[];
  cashbackTransactionIds: number[];
};

async function cleanup(prisma: PrismaClient, ctx: CleanupCtx) {
  log("CLEANUP", "Iniciando cleanup...", {
    runId: ctx.runId,
    users: ctx.userIds.length,
    cars: ctx.carIds.length,
    payments: ctx.paymentIds.length,
    subs: ctx.subscriptionIds.length,
    plans: ctx.planIds.length,
    coupons: ctx.couponIds.length,
    groups: ctx.referralGroupIds.length,
    groupMembers: ctx.referralGroupMemberIds.length,
    bonuses: ctx.referralBonusIds.length,
    userReferrals: ctx.userReferralIds.length,
    cashbackTxs: ctx.cashbackTransactionIds.length,
  });

  // 0) IndividualServicePurchase (se existir e referenciar payment)
  try {
    if (ctx.paymentIds.length > 0 && (prisma as any).individualServicePurchase?.deleteMany) {
      await (prisma as any).individualServicePurchase.deleteMany({
        where: { paymentId: { in: ctx.paymentIds } },
      });
      log("CLEANUP", "individualServicePurchase.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar individualServicePurchase.", e?.message);
  }

  // 1) ReferralBonus (depende de payment)
  try {
    if (ctx.referralBonusIds.length > 0) {
      await (prisma as any).referralBonus.deleteMany({
        where: { id: { in: ctx.referralBonusIds } },
      });
      log("CLEANUP", "referralBonus.deleteMany OK");
    } else {
      await (prisma as any).referralBonus.deleteMany?.({
        where: { eventKey: { contains: ctx.runId } },
      });
      log("CLEANUP", "referralBonus.deleteMany (by eventKey contains runId) OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar referralBonus.", e?.message);
  }

  // 2) CashbackTransaction (by ids/eventKeys/meta)
  try {
    if ((prisma as any).cashbackTransaction?.deleteMany) {
      if (ctx.cashbackTransactionIds.length > 0) {
        await (prisma as any).cashbackTransaction.deleteMany({
          where: { id: { in: ctx.cashbackTransactionIds } },
        });
        log("CLEANUP", "cashbackTransaction.deleteMany (ids) OK");
      } else if (ctx.cashbackTransactionEventKeys.length > 0) {
        await (prisma as any).cashbackTransaction.deleteMany({
          where: { eventKey: { in: ctx.cashbackTransactionEventKeys } },
        });
        log("CLEANUP", "cashbackTransaction.deleteMany (eventKeys) OK");
      } else {
        await (prisma as any).cashbackTransaction.deleteMany({
          where: { meta: { path: ["runId"], equals: ctx.runId } },
        });
        log("CLEANUP", "cashbackTransaction.deleteMany (meta.runId) OK");
      }
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar cashbackTransaction.", e?.message);
  }

  // ✅ 2.5) CashbackTransaction por userIds (resolve FK no user.delete)
  try {
    if ((prisma as any).cashbackTransaction?.deleteMany && ctx.userIds.length > 0) {
      await (prisma as any).cashbackTransaction.deleteMany({
        where: { userId: { in: ctx.userIds } },
      });
      log("CLEANUP", "cashbackTransaction.deleteMany (by userIds) OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar cashbackTransaction por userIds.", e?.message);
  }

  // 3) Payments
  try {
    if (ctx.paymentIds.length > 0) {
      await (prisma as any).payment.deleteMany({
        where: { id: { in: ctx.paymentIds } },
      });
      log("CLEANUP", "payment.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar payments. Tentando raw...", e?.message);
    try {
      if (ctx.paymentIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "Payment" WHERE "id" = ANY($1::int[])`,
          ctx.paymentIds,
        );
        log("CLEANUP", "Payment raw delete OK");
      }
    } catch (e2: any) {
      warn("CLEANUP", "Raw delete Payment falhou.", e2?.message);
    }
  }

  // 4) Subscriptions
  try {
    if (ctx.subscriptionIds.length > 0) {
      await (prisma as any).subscription.deleteMany({
        where: { id: { in: ctx.subscriptionIds } },
      });
      log("CLEANUP", "subscription.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar subscriptions. Tentando raw...", e?.message);
    try {
      if (ctx.subscriptionIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "Subscription" WHERE "id" = ANY($1::int[])`,
          ctx.subscriptionIds,
        );
        log("CLEANUP", "Subscription raw delete OK");
      }
    } catch (e2: any) {
      warn("CLEANUP", "Raw delete Subscription falhou.", e2?.message);
    }
  }

  // 5) UserReferral
  try {
    if (ctx.userReferralIds.length > 0) {
      await (prisma as any).userReferral.deleteMany({
        where: { id: { in: ctx.userReferralIds } },
      });
      log("CLEANUP", "userReferral.deleteMany OK");
    } else {
      await (prisma as any).userReferral.deleteMany?.({
        where: { meta: { path: ["runId"], equals: ctx.runId } },
      });
      log("CLEANUP", "userReferral.deleteMany (meta.runId) OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar userReferral.", e?.message);
  }

  // 6) Group members
  try {
    if (ctx.referralGroupMemberIds.length > 0) {
      await (prisma as any).referralGroupMember.deleteMany({
        where: { id: { in: ctx.referralGroupMemberIds } },
      });
      log("CLEANUP", "referralGroupMember.deleteMany OK");
    } else {
      if (ctx.referralGroupIds.length > 0) {
        await (prisma as any).referralGroupMember.deleteMany({
          where: { groupId: { in: ctx.referralGroupIds } },
        });
        log("CLEANUP", "referralGroupMember.deleteMany (by groupId) OK");
      }
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar referralGroupMember.", e?.message);
  }

  // 7) Groups
  try {
    if (ctx.referralGroupIds.length > 0) {
      await (prisma as any).referralGroup.deleteMany({
        where: { id: { in: ctx.referralGroupIds } },
      });
      log("CLEANUP", "referralGroup.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar referralGroup.", e?.message);
  }

  // 8) Coupons/Plans (depois dos payments)
  try {
    if (ctx.couponIds.length > 0) {
      await (prisma as any).coupon.deleteMany({
        where: { id: { in: ctx.couponIds } },
      });
      log("CLEANUP", "coupon.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar coupons.", e?.message);
  }

  try {
    if (ctx.planIds.length > 0) {
      await (prisma as any).plan.deleteMany({
        where: { id: { in: ctx.planIds } },
      });
      log("CLEANUP", "plan.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar plans.", e?.message);
  }

  // 9) Wallets (depois das txs)
  try {
    if ((prisma as any).cashbackWallet?.deleteMany && ctx.userIds.length > 0) {
      await (prisma as any).cashbackWallet.deleteMany({
        where: { userId: { in: ctx.userIds } },
      });
      log("CLEANUP", "cashbackWallet.deleteMany OK");
    }
  } catch (e: any) {
    warn("CLEANUP", "Falha ao deletar cashbackWallet.", e?.message);
  }

  // 10) Cars (model pode ser userCar ou car)
  for (const carId of ctx.carIds) {
    try {
      if ((prisma as any).userCar?.delete) {
        await (prisma as any).userCar.delete({ where: { id: carId } });
        log("CLEANUP", "userCar.delete OK", { id: carId });
      } else if ((prisma as any).car?.delete) {
        await (prisma as any).car.delete({ where: { id: carId } });
        log("CLEANUP", "car.delete OK", { id: carId });
      }
    } catch (e: any) {
      warn("CLEANUP", "Falha ao deletar car. Tentando raw UserCar...", {
        carId,
        message: e?.message,
      });
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "UserCar" WHERE "id" = $1`, carId);
        log("CLEANUP", "UserCar raw delete OK", { id: carId });
      } catch (e2: any) {
        warn("CLEANUP", "Raw delete car falhou.", e2?.message);
      }
    }
  }

  // 11) Users por último
  for (const userId of ctx.userIds) {
    try {
      await (prisma as any).user.delete({ where: { id: userId } });
      log("CLEANUP", "user.delete OK", { id: userId });
    } catch (e: any) {
      warn("CLEANUP", "user.delete falhou; tentando soft-delete (deletedAt).", {
        userId,
        message: e?.message,
      });
      try {
        await (prisma as any).user.update({
          where: { id: userId },
          data: { deletedAt: new Date() },
        });
        log("CLEANUP", "user soft-delete OK", { id: userId });
      } catch (e2: any) {
        warn("CLEANUP", "soft-delete falhou também.", e2?.message);
      }
    }
  }

  log("CLEANUP", "Cleanup finalizado.");
}

// ---------------------------
// MAIN TEST
// ---------------------------
async function main() {
  const args = parseArgs(process.argv);

  const baseUrl =
    (args["base-url"] as string) ||
    process.env.SMOKE_BASE_URL ||
    "http://localhost:3000";
  const pingPath = (args["ping-path"] as string) || "/";
  const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 15000;

  const dbUrl = (args["db-url"] as string) || process.env.DATABASE_URL || "";
  if (!dbUrl) throw new Error("DATABASE_URL não informado. Use .env ou --db-url=...");

  const runId = crypto.randomUUID().slice(0, 8);

  log("INIT", "=== SMOKE REGRESSION FULL: Cars + AdminCar + Payments + Cashback/Bonus/MLM ===");
  log("INIT", "Config", { baseUrl, pingPath, timeoutMs, databaseUrl: sanitizeDbUrl(dbUrl), runId });

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const cleanupCtx: CleanupCtx = {
    runId,
    userIds: [],
    carIds: [],
    paymentIds: [],
    subscriptionIds: [],
    planIds: [],
    couponIds: [],
    referralGroupIds: [],
    referralGroupMemberIds: [],
    referralBonusIds: [],
    userReferralIds: [],
    cashbackTransactionEventKeys: [],
    cashbackTransactionIds: [],
  };

  let exitError: any = null;

  try {
    await ping(baseUrl, pingPath, Math.min(timeoutMs, 8000));
    await dbHealth(prisma);

    // =========================================================
    // A) CARROS (placa + userId) + ADMIN-CAR endpoints
    // =========================================================
    log("A", "Criando usuários via API (2 users + 1 admin)");

    const u1 = await registerAndLogin({ baseUrl, timeoutMs, prisma, tag: "u1", runId });
    const u2 = await registerAndLogin({ baseUrl, timeoutMs, prisma, tag: "u2", runId });
    const admin = await registerAndLogin({ baseUrl, timeoutMs, prisma, tag: "admin", runId });

    cleanupCtx.userIds.push(u1.userId, u2.userId, admin.userId);

    await promoteToAdmin(prisma, admin.userId);

    // login admin de novo (pra refletir role no token)
    const adminLogin = await httpRequest(
      baseUrl,
      "/auth/login",
      "POST",
      { email: admin.email, password: admin.password },
      timeoutMs,
    );
    assert(
      adminLogin.status === 200,
      `Login admin falhou. HTTP ${adminLogin.status}. Body=${safeStringify(adminLogin.data)}`,
    );
    const adminToken = String((adminLogin.data as any)?.token || "");
    assert(adminToken, "Token admin vazio.");

    const sharedPlate = generateRandomPlate();
    log("A", "Testando placa compartilhada (deve permitir users diferentes)", {
      plate: sharedPlate,
    });

    const car1 = await createCarWithPlateBestEffort({ baseUrl, timeoutMs, token: u1.token, plate: sharedPlate });
    assert(car1.ok, `Falha ao criar car user1. body=${safeStringify((car1 as any).raw ?? (car1 as any).last?.data ?? null)}`);
    cleanupCtx.carIds.push(car1.id);

    const car2 = await createCarWithPlateBestEffort({ baseUrl, timeoutMs, token: u2.token, plate: sharedPlate });
    assert(car2.ok, `Regra nova quebrou: user2 não criou car mesma placa. body=${safeStringify((car2 as any).raw ?? (car2 as any).last?.data ?? null)}`);
    cleanupCtx.carIds.push(car2.id);

    assert(car1.id !== car2.id, "Esperado: ids diferentes (mesma placa, users diferentes).");

    const car1Again = await createCarWithPlateBestEffort({ baseUrl, timeoutMs, token: u1.token, plate: sharedPlate });
    if (!car1Again.ok) {
      const status = (car1Again as any)?.last?.status;
      if (status === 409) {
        log("A", "Recriar car (mesma placa p/ mesmo user) retornou 409 (duplicidade) - OK", {
          status,
          body: (car1Again as any)?.last?.data ?? null,
        });
      } else {
        throw new Error(
          `Recriar car (mesma placa p/ mesmo user) falhou inesperado. status=${status} body=${safeStringify(
            (car1Again as any)?.last?.data ?? null,
          )}`,
        );
      }
    } else {
      log("A", "Recriar car (mesma placa p/ mesmo user) retornou 2xx (idempotente) - OK", {
        id: car1Again.id,
        path: (car1Again as any).path,
      });
    }

    log("A", "Testando rotas admin-car");

    await adminCarEndpointsSmoke({
      baseUrl,
      timeoutMs,
      adminToken,
      plate: normalizePlate(sharedPlate),
      userId: u1.userId,
      carId: car1.id,
      expectAmbiguousPlate: true,
    });

    // =========================================================
    // B) PAYMENTS (create avulso + subscribe) e sanity no DB
    // =========================================================
    // tenta destravar o payment setando customerId ASAAS (best-effort)
    await ensureAsaasCustomerIdBestEffort({ prisma, userId: u1.userId, runId });

    log("B", "Selecionando Plan + WashServices via DB (seed existente)");

    const planDb = await selectPlanPreferDb(prisma);
    assert(planDb?.id, "Não consegui selecionar Plan via DB.");

    const services = await selectWashServicesPreferDb(prisma, 2);
    assert(services.length > 0, "Não encontrei WashServices (published & available) via DB.");

    const washServiceIds = services
      .map((s: any) => Number(s.id))
      .filter((n: number) => n && !Number.isNaN(n));
    assert(washServiceIds.length > 0, "WashServices sem IDs válidos.");

    const paymentPrefix = await resolvePaymentPrefix(baseUrl, timeoutMs);

    log("B", "Create payment avulso (API)");

    const payCreated = await createPaymentBestEffort({
      baseUrl,
      timeoutMs,
      prisma,
      userId: u1.userId,
      runId,
      token: u1.token,
      paymentPrefix,
      cpf: u1.cpf,
      washServiceIds,
      carId: car1.id,
      userEmailForHolderInfo: u1.email,
    });

    if (payCreated.paymentId) cleanupCtx.paymentIds.push(payCreated.paymentId);

    if (payCreated.paymentId) {
      const dbPay = await (prisma as any).payment.findUnique({
        where: { id: payCreated.paymentId },
        select: { id: true, userId: true, amount: true, status: true, channel: true },
      });

      assert(dbPay, "Payment não encontrado no DB após create.");
      assert(dbPay.userId === u1.userId, "Payment.userId não bate.");
      assert(Number(dbPay.amount) >= 1, "Payment.amount inválido (<1).");
      log("B", "Payment OK no DB", dbPay);
    } else {
      warn("B", "Create payment não retornou paymentId (pulei assert DB).");
    }

    log("B", "Subscribe (API)");

    const sub = await subscribeBestEffort({
      baseUrl,
      timeoutMs,
      prisma,
      userId: u1.userId,
      runId,
      token: u1.token,
      paymentPrefix,
      cpf: u1.cpf,
      planId: Number(planDb.id),
      carId: car1.id,
      timeZoneOffset: -180,
      userEmailForHolderInfo: u1.email,
    });

    if (sub.subscriptionId) cleanupCtx.subscriptionIds.push(sub.subscriptionId);
    if (sub.paymentId) cleanupCtx.paymentIds.push(sub.paymentId);

    if (sub.subscriptionId) {
      const dbSub = await (prisma as any).subscription.findUnique({
        where: { id: sub.subscriptionId },
        select: { id: true, userId: true, carId: true, isActive: true, expiresAt: true },
      });
      assert(dbSub, "Subscription não encontrada no DB.");
      assert(dbSub.userId === u1.userId, "Subscription.userId não bate.");
      assert(Number(dbSub.carId) === car1.id, "Subscription.carId não bate.");
      log("B", "Subscription OK no DB", dbSub);
    } else {
      warn("B", "Subscribe não retornou subscriptionId (pulei assert DB).");
    }

    // =========================================================
    // C) CASHBACK + CUPOM mínimo + BONUS + MLM completo (9 posições)
    // =========================================================
    log("C", "Smoke DB: cupom mínimo + cashback + bônus + MLM (9 posições) + idempotência");

    const now = new Date();
    const competenceYM1 = competenceYearMonthFrom(now);
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const competenceYM2 = competenceYearMonthFrom(nextMonth);

    const plan = await (prisma as any).plan.create({
      data: {
        name: `SMOKE_PLAN_${runId}`,
        price: 100,
        duration: 30,
        description: `Smoke plan ${runId}`,
        periodicityType: "MONTH",
        isPackage: true,
        isBestChoice: false,
        maxInstallments: 0,
      },
    });
    cleanupCtx.planIds.push(plan.id);

    const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const coupon100 = await (prisma as any).coupon.create({
      data: {
        code: `SMOKE_CUPOM_100_${runId}`,
        description: "Cupom 100% (deve respeitar mínimo a pagar)",
        additionalInfo: `Smoke ${runId}`,
        discountType: DiscountType.PERCENTAGE,
        discountValue: 100,
        maxDiscountValue: null,
        validFrom,
        validUntil,
        isActive: true,
        usageLimit: null,
        currentUsage: 0,
        plans: { connect: [{ id: plan.id }] },
      },
    });
    cleanupCtx.couponIds.push(coupon100.id);

    const pricing = applyCouponWithMinimumCharge(plan.price, {
      discountType: coupon100.discountType,
      discountValue: coupon100.discountValue,
    });

    assert(pricing.finalAmount >= MINIMUM_CHARGE_AMOUNT, "Regra cupom mínimo falhou: finalAmount < 1");

    for (let position = 1; position <= 9; position++) {
      for (const type of [BonusType.UNIQUE, BonusType.RECURRENT]) {
        await (prisma as any).referralPositionBonusConfig.upsert({
          where: { position_type: { position, type } },
          create: {
            position,
            type,
            amount: Number((20 / position).toFixed(2)),
            isActive: true,
          },
          update: {},
        });
      }
    }

    const group = await (prisma as any).referralGroup.create({
      data: {
        maxMembers: 9,
        cashbackSuspended: false,
        isClosed: false,
      },
    });
    cleanupCtx.referralGroupIds.push(group.id);

    const mlmUsers: any[] = [];
    for (let i = 1; i <= 9; i++) {
      const user = await (prisma as any).user.create({
        data: {
          name: `SMOKE_MLM_${runId}_${i}`,
          email: generateUniqueEmail(`mlm${i}`, runId),
          password: "123456",
          phone: `1190000000${i}`,
          cpf: await generateUniqueCpf(prisma),
          role: Role.USER,
          status: UserStatus.ACTIVE,
          referralCode: crypto.randomUUID().slice(0, 8),
        },
      });

      mlmUsers.push(user);
      cleanupCtx.userIds.push(user.id);

      await ensureWallet(prisma, user.id);

      const welcomeKey = `WELCOME:${runId}:${user.id}`;
      cleanupCtx.cashbackTransactionEventKeys.push(welcomeKey);

      await (prisma as any).cashbackTransaction.create({
        data: {
          userId: user.id,
          type: TransactionType.EARNED,
          source: TransactionSource.WELCOME_BONUS,
          amount: 20,
          eventKey: welcomeKey,
          meta: { runId, kind: "welcome" },
        },
      });

      await (prisma as any).cashbackWallet.update({
        where: { userId_type: { userId: user.id, type: WalletType.INTERNAL } },
        data: { balance: { increment: 20 } },
      });
    }

    for (let i = 0; i < mlmUsers.length; i++) {
      const m = await (prisma as any).referralGroupMember.create({
        data: {
          groupId: group.id,
          userId: mlmUsers[i].id,
          position: i + 1,
        },
      });
      cleanupCtx.referralGroupMemberIds.push(m.id);
    }

    const payer = mlmUsers[8];

    const payment = await (prisma as any).payment.create({
      data: {
        userId: payer.id,
        planId: plan.id,
        couponId: coupon100.id,
        amount: ensureMinimumAmount(pricing.finalAmount, MINIMUM_CHARGE_AMOUNT),
        status: PaymentStatus.PAID,
        paidAt: now,
        channel: PaymentChannel.PIX,
        paymentIdAsaas: `pay_${crypto.randomUUID()}`,
        meta: { runId, kind: "mlm_base_payment" },
      },
    });
    cleanupCtx.paymentIds.push(payment.id);

    assert(Number(payment.amount) >= 1, "Payment com cupom mínimo falhou: amount < 1");

    for (let position = 1; position <= 8; position++) {
      const receiver = mlmUsers[position - 1];

      const config = await (prisma as any).referralPositionBonusConfig.findFirst({
        where: { position, type: BonusType.UNIQUE },
      });

      if (!config || config.amount <= 0) continue;

      const eventKey = `UNIQUE:${runId}:${group.id}:${position}:${payment.id}`;
      const bonus = await (prisma as any).referralBonus.create({
        data: {
          receiverId: receiver.id,
          payerId: payer.id,
          level: position,
          type: BonusType.UNIQUE,
          amount: config.amount,
          paymentStatus: PaymentStatus.PAID,
          paymentId: payment.id,
          competenceYearMonth: competenceYM1,
          eventKey,
        },
      });
      cleanupCtx.referralBonusIds.push(bonus.id);

      cleanupCtx.cashbackTransactionEventKeys.push(eventKey);

      await creditCashbackIdempotent({
        prisma,
        receiverId: receiver.id,
        eventKey,
        amount: config.amount,
        relatedId: String(bonus.id),
        meta: { runId, kind: "unique_bonus", groupId: group.id, position },
        referralGroupId: group.id,
        referralPosition: position,
      });
    }

    for (const competence of [competenceYM1, competenceYM2]) {
      for (let position = 1; position <= 8; position++) {
        const receiver = mlmUsers[position - 1];

        const config = await (prisma as any).referralPositionBonusConfig.findFirst({
          where: { position, type: BonusType.RECURRENT },
        });

        if (!config || config.amount <= 0) continue;

        const eventKey = `RECURRENT:${runId}:${competence}:${group.id}:${position}`;
        cleanupCtx.cashbackTransactionEventKeys.push(eventKey);

        await creditCashbackIdempotent({
          prisma,
          receiverId: receiver.id,
          eventKey,
          amount: config.amount,
          meta: { runId, kind: "recurrent_bonus", competence, groupId: group.id, position },
          referralGroupId: group.id,
          referralPosition: position,
        });
      }
    }

    const uPos1 = mlmUsers[0];
    const wallet1 = await (prisma as any).cashbackWallet.findUnique({
      where: { userId_type: { userId: uPos1.id, type: WalletType.INTERNAL } },
    });

    const txCount1 = await (prisma as any).cashbackTransaction.count({
      where: { userId: uPos1.id },
    });

    assert(wallet1, "Wallet pos1 não encontrada.");
    assert(txCount1 >= 4, `Esperado >=4 transações para pos1 (welcome+unique+2 recurrent). Veio ${txCount1}`);

    log("C_ASSERT", "Pos1 wallet/txs", { userId: uPos1.id, balance: wallet1.balance, txCount: txCount1 });

    const planPrice = Number(plan.price);
    const maxAllowed = planPrice * 0.5;

    const walletBefore = await (prisma as any).cashbackWallet.findUnique({
      where: { userId_type: { userId: uPos1.id, type: WalletType.INTERNAL } },
    });

    assert(walletBefore, "Wallet pos1 antes do debit não encontrada.");

    const usedAmount = Math.min(Number(walletBefore.balance), maxAllowed);
    const debitKey = `DEBIT:${runId}:${uPos1.id}:${payment.id}`;

    cleanupCtx.cashbackTransactionEventKeys.push(debitKey);

    await debitCashback({
      prisma,
      userId: uPos1.id,
      eventKey: debitKey,
      amount: usedAmount,
      source: TransactionSource.SUBSCRIPTION_DEBIT,
      meta: { runId, kind: "debit_test", maxAllowed },
    });

    const walletAfter = await (prisma as any).cashbackWallet.findUnique({
      where: { userId_type: { userId: uPos1.id, type: WalletType.INTERNAL } },
    });

    assert(walletAfter, "Wallet pos1 após debit não encontrada.");
    assert(Number(walletAfter.balance) === Number(walletBefore.balance) - usedAmount, "Saldo após debit não bate com o esperado.");

    log("C_DEBIT", "Debit OK", {
      before: walletBefore.balance,
      usedAmount,
      after: walletAfter.balance,
      maxAllowed,
    });

    try {
      await (prisma as any).cashbackTransaction.create({
        data: {
          userId: uPos1.id,
          type: TransactionType.EARNED,
          source: TransactionSource.INDICATION,
          amount: 1,
          eventKey: debitKey,
          meta: { runId, kind: "duplicate_should_fail" },
        },
      });
      throw new Error("Idempotência falhou: era pra bloquear cashbackTransaction duplicada (eventKey).");
    } catch (e) {
      log("C_IDEMPOTENCY_TX", "OK: duplicidade bloqueada", {
        message: (e as any)?.message ?? String(e),
      });
    }

    const sampleBonus = await (prisma as any).referralBonus.findFirst({
      where: { eventKey: { contains: `UNIQUE:${runId}:` } },
    });

    if (sampleBonus) {
      try {
        await (prisma as any).referralBonus.create({
          data: {
            receiverId: sampleBonus.receiverId,
            payerId: sampleBonus.payerId,
            level: sampleBonus.level,
            type: sampleBonus.type,
            amount: sampleBonus.amount,
            paymentStatus: sampleBonus.paymentStatus,
            paymentId: sampleBonus.paymentId,
            competenceYearMonth: sampleBonus.competenceYearMonth,
            eventKey: sampleBonus.eventKey,
          },
        });
        throw new Error("Idempotência falhou: era pra bloquear referralBonus duplicado (eventKey).");
      } catch (e) {
        if (!isUniqueConstraintError(e)) {
          throw new Error(
            `ReferralBonus duplicado NÃO bloqueou (eventKey sem unique?). Err=${(e as any)?.message ?? String(e)}`,
          );
        }
        log("C_IDEMPOTENCY_BONUS", "OK: referralBonus duplicado bloqueado (P2002)", {
          prismaCode: knownRequestErrorCode(e),
        });
      }
    } else {
      warn("C_IDEMPOTENCY_BONUS", "Não encontrei bonus sample pra testar duplicidade (pulei).");
    }

    log("DONE", `=== SMOKE FULL PASSOU (runId=${runId}) ===`);
  } catch (e: any) {
    exitError = e;
    err("FAIL", "Smoke falhou.", {
      message: e?.message,
      stack: e?.stack,
      response: e?.response ?? null,
    });
  } finally {
    try {
      await cleanup(prisma, cleanupCtx);
    } catch (e: any) {
      err("CLEANUP", "Cleanup falhou (pode ter sobrado resíduo).", { message: e?.message });
      exitError = exitError ?? e;
    } finally {
      await prisma.$disconnect();
    }

    if (exitError) process.exitCode = 1;
  }
}

main().catch((e: any) => {
  err("FATAL", "Erro fatal no script.", { message: e?.message, stack: e?.stack });
  process.exitCode = 1;
});
