/* eslint-disable no-console */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type StepReport = {
    name: string;
    ok: boolean;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    details?: any;
    error?: { message?: string; stack?: string; response?: any };
};

type SmokeReport = {
    startedAt: string;
    endedAt?: string;
    ok: boolean;
    failReason?: string;
    context: Record<string, any>;
    steps: StepReport[];
};

function nowIso(): string {
    return new Date().toISOString();
}

function msSince(start: number): number {
    return Date.now() - start;
}

function log(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}]`;
    if (data !== undefined) {
        console.log(prefix, message, data);
        return;
    }
    console.log(prefix, message);
}

function warn(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}] [WARN]`;
    if (data !== undefined) {
        console.warn(prefix, message, data);
        return;
    }
    console.warn(prefix, message);
}

function err(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}] [ERROR]`;
    if (data !== undefined) {
        console.error(prefix, message, data);
        return;
    }
    console.error(prefix, message);
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

function describeFetchError(e: any) {
    const cause = e?.cause;
    return {
        message: e?.message,
        name: e?.name,
        cause: cause
            ? {
                name: cause?.name,
                message: cause?.message,
                code: cause?.code,
                errno: cause?.errno,
                syscall: cause?.syscall,
                address: cause?.address,
                port: cause?.port,
            }
            : null,
    };
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
    } catch (e: any) {
        err("HTTP", "Falha de conexão ao chamar endpoint (fetch).", {
            url,
            method,
            error: describeFetchError(e),
        });
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

async function pingBaseUrl(baseUrl: string, pingPath: string, timeoutMs: number) {
    log("PING", "Pingando API para validar conectividade...", {
        baseUrl,
        pingPath,
        timeoutMs,
    });
    const r = await httpRequest(baseUrl, pingPath, "GET", null, timeoutMs);
    log("PING", "Ping OK (conectou).", {
        url: r.url,
        status: r.status,
        obs: "Status pode ser 200/401/404; o importante é conectar.",
    });
}

async function dbHealthCheck(prisma: PrismaClient) {
    log("DB", "Rodando healthcheck do banco (SELECT 1)...");
    const r = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 as ok`);
    log("DB", "DB healthcheck OK.", { result: r?.[0] ?? null });
}

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * CPF válido (11 dígitos).
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
    for (let attempt = 1; attempt <= 50; attempt++) {
        const cpf = generateValidCpf();
        const exists = await prisma.user.findUnique({ where: { cpf } as any });
        if (!exists) return cpf;
    }
    throw new Error("Não consegui gerar CPF único após 50 tentativas.");
}

function generateUniqueEmail(): string {
    const ts = Date.now();
    const r = Math.random().toString(16).slice(2);
    return `smoke.payments.${ts}.${r}@example.com`.toLowerCase();
}

function normalizePlate(plate: string): string {
    return (plate ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateRandomPlate(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const pick = (s: string) => s[randInt(0, s.length - 1)];
    const isMercosul = Math.random() > 0.5;

    if (isMercosul) {
        return normalizePlate(
            `${pick(letters)}${pick(letters)}${pick(letters)}${randInt(0, 9)}${pick(letters)}${randInt(0, 9)}${randInt(0, 9)}`,
        );
    }

    return normalizePlate(
        `${pick(letters)}${pick(letters)}${pick(letters)}${randInt(0, 9)}${randInt(0, 9)}${randInt(0, 9)}${randInt(0, 9)}`,
    );
}

async function selectPlanPreferDb(prisma: PrismaClient) {
    const plan = await (prisma as any).plan.findFirst({
        where: { price: { gt: 0 } },
        orderBy: [{ isPackage: "desc" }, { id: "asc" }],
        select: {
            id: true,
            name: true,
            price: true,
            duration: true,
            isPackage: true,
            periodicityType: true,
            extraMonths: true,
            maxInstallments: true,
        },
    });

    return plan ?? null;
}

async function selectWashServicesPreferDb(prisma: PrismaClient, take = 2) {
    const services = await (prisma as any).washService.findMany({
        where: {
            isPublished: true,
            isAvailable: true,
        },
        orderBy: { id: "asc" },
        take,
        select: {
            id: true,
            name: true,
            price: true,
            isPublished: true,
            isAvailable: true,
        },
    });

    return Array.isArray(services) ? services : [];
}

/**
 * Variações de telefone para tentar passar em validações diferentes (regex/normalização).
 * A API te respondeu "Telefone inválido", então precisamos cobrir os formatos mais comuns.
 */
function getPhoneVariants(): string[] {
    return [
        "11999999999",
        "11 99999-9999",
        "(11) 99999-9999",
        "5511999999999",
        "+5511999999999",
    ];
}

/**
 * Monta um bloco de holderInfo consistente para testes.
 */
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

/**
 * Tenta criar o carro por API em múltiplos paths e, se não existir rota, cria direto via DB.
 * No seu routes.ts o mount é "/user-car".
 */
async function createCarBestEffort(params: {
    baseUrl: string;
    timeoutMs: number;
    token: string;
    prisma: PrismaClient;
    userId: number;
    preferredPath?: string;
}) {
    const { baseUrl, timeoutMs, token, prisma, userId, preferredPath } = params;

    const plate = generateRandomPlate();
    const carPayload: Json = {
        licensePlate: plate,
        brand: "SMOKE",
        model: "SMOKE-CAR",
        color: "BLACK",
        year: 2024,
    };

    const candidatePaths = [
        preferredPath,
        "/user-car",
        "/cars",
        "/user-cars",
        "/userCars",
        "/usercars",
        "/car",
        "/my-cars",
    ].filter(Boolean) as string[];

    for (const path of candidatePaths) {
        const stepKey = `CAR_API:${path}`;
        try {
            const r = await httpRequest(baseUrl, path, "POST", carPayload, timeoutMs, {
                Authorization: `Bearer ${token}`,
            });

            log(stepKey, "Tentativa create car via API", { url: r.url, status: r.status });

            if (r.status === 404) continue;

            if (r.status >= 200 && r.status < 300) {
                const id = Number((r.data as any)?.id ?? (r.data as any)?.car?.id);
                if (id && !Number.isNaN(id)) {
                    return {
                        origin: "api" as const,
                        path,
                        id,
                        plate,
                        raw: r.data,
                    };
                }

                warn(stepKey, "API respondeu 2xx mas não encontrei id no payload.", {
                    jsonKeys: typeof r.data === "object" && r.data ? Object.keys(r.data) : null,
                    data: r.data,
                });
            } else {
                warn(stepKey, "API respondeu não-2xx ao criar carro.", {
                    status: r.status,
                    data: r.data,
                });
            }
        } catch (e: any) {
            warn(stepKey, "Erro na tentativa de criar carro via API.", { message: e?.message });
        }
    }

    log("CAR_DB", "Nenhuma rota de carro válida encontrada. Fazendo fallback para criação via DB...");

    const clientAny = prisma as any;

    const candidates = [
        { modelName: "userCar", client: clientAny.userCar },
        { modelName: "car", client: clientAny.car },
    ].filter((c) => Boolean(c.client?.create));

    if (!candidates.length) {
        throw new Error(
            'Não existe model "userCar" ou "car" disponível no PrismaClient para fallback via DB. (Verifique o schema do Prisma).',
        );
    }

    const payloadAttempts: Json[] = [
        { userId, ...carPayload },
        {
            userId,
            plate: plate,
            brand: carPayload.brand,
            model: carPayload.model,
            color: carPayload.color,
            year: carPayload.year,
        },
        { userId, licensePlate: plate },
        { userId, plate: plate },
    ];

    let lastError: any = null;

    for (const c of candidates) {
        for (const data of payloadAttempts) {
            try {
                const created = await c.client.create({ data });
                const id = Number(created?.id);
                if (id && !Number.isNaN(id)) {
                    log("CAR_DB", "Carro criado via DB com sucesso.", {
                        model: c.modelName,
                        id,
                        plate,
                    });
                    return {
                        origin: "db" as const,
                        model: c.modelName,
                        id,
                        plate,
                        raw: created,
                    };
                }
            } catch (e: any) {
                lastError = e;
            }
        }
    }

    throw new Error(
        `Falha ao criar carro via DB (fallback). Último erro: ${lastError?.message ?? "desconhecido"}`,
    );
}

async function resolvePaymentPrefix(baseUrl: string, timeoutMs: number) {
    const candidates = ["/payment", "/payments"];

    for (const prefix of candidates) {
        try {
            const r = await httpRequest(baseUrl, prefix, "GET", null, Math.min(timeoutMs, 8000));
            if (r.status !== 404) {
                log("PAYMENT_BASE", "Prefix do payment resolvido", { prefix, status: r.status });
                return prefix;
            }
        } catch {
            // ignore
        }
    }

    log("PAYMENT_BASE", "Não consegui validar prefix por GET. Vou assumir /payment (routes.ts).", {
        assumed: "/payment",
    });
    return "/payment";
}

async function createPaymentBestEffort(params: {
    baseUrl: string;
    timeoutMs: number;
    token: string;
    paymentPrefix: string;
    cpf: string;
    washServiceIds: number[];
    carId: number | null;
    userEmailForHolderInfo: string;
}) {
    const { baseUrl, timeoutMs, token, paymentPrefix, cpf, washServiceIds, carId, userEmailForHolderInfo } = params;

    const endpoint = paymentPrefix; // POST "/" dentro do router payment => mount "/payment" => POST "/payment"
    const headers = { Authorization: `Bearer ${token}` };

    const typeVariants = ["pix", "PIX", "Pix"];
    const phoneVariants = getPhoneVariants();

    const payloads: Json[] = [];

    /**
     * IMPORTANTE:
     * A sua API devolveu "Telefone inválido" no create payment PIX.
     * Então aqui fazemos tentativa com:
     * - phone no nível raiz (algumas APIs aceitam)
     * - creditCardHolderInfo com phone/mobilePhone (mesmo para PIX)
     * - variações de nomes já existentes (washServices / washServiceIds / etc.)
     * - variações cpf vs cpfCnpj
     */
    for (const t of typeVariants) {
        for (const phone of phoneVariants) {
            const holderInfo = buildHolderInfo({ cpf, email: userEmailForHolderInfo, phone });

            // ----- Payloads mais completos primeiro (para bater em validações obrigatórias) -----

            payloads.push({
                type: t,
                cpf,
                washServices: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            payloads.push({
                type: t,
                cpf,
                washServiceIds: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            payloads.push({
                type: t,
                cpf,
                serviceIds: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            payloads.push({
                type: t,
                cpf,
                servicesIds: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            payloads.push({
                type: t,
                cpf,
                washServicesIds: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            // Variação cpfCnpj em vez de cpf (alguns DTOs usam cpfCnpj)
            payloads.push({
                type: t,
                cpfCnpj: cpf,
                washServices: washServiceIds,
                creditCardHolderInfo: holderInfo,
            });

            // Phone no topo (alguns backends aceitam assim)
            payloads.push({
                type: t,
                cpf,
                phone,
                washServices: washServiceIds,
            });

            // ----- Variantes com carId / userCarId -----
            if (carId) {
                payloads.push({
                    type: t,
                    cpf,
                    washServices: washServiceIds,
                    carId,
                    creditCardHolderInfo: holderInfo,
                });

                payloads.push({
                    type: t,
                    cpf,
                    washServices: washServiceIds,
                    userCarId: carId,
                    creditCardHolderInfo: holderInfo,
                });

                payloads.push({
                    type: t,
                    cpf,
                    washServiceIds: washServiceIds,
                    carId,
                    creditCardHolderInfo: holderInfo,
                });

                payloads.push({
                    type: t,
                    cpf,
                    washServiceIds: washServiceIds,
                    userCarId: carId,
                    creditCardHolderInfo: holderInfo,
                });

                payloads.push({
                    type: t,
                    cpf,
                    servicesIds: washServiceIds,
                    carId,
                    creditCardHolderInfo: holderInfo,
                });

                payloads.push({
                    type: t,
                    cpf,
                    servicesIds: washServiceIds,
                    userCarId: carId,
                    creditCardHolderInfo: holderInfo,
                });

                // Phone no topo + carId
                payloads.push({
                    type: t,
                    cpf,
                    phone,
                    washServices: washServiceIds,
                    carId,
                });

                payloads.push({
                    type: t,
                    cpf,
                    phone,
                    washServices: washServiceIds,
                    userCarId: carId,
                });
            }

            // ----- Mantém as tentativas antigas (sem holderInfo), mas agora elas ficam por último -----

            payloads.push({ type: t, cpf, washServices: washServiceIds });
            payloads.push({ type: t, cpf, servicesIds: washServiceIds });
            payloads.push({ type: t, cpf, washServicesIds: washServiceIds });
            payloads.push({ type: t, cpf, washServiceIds: washServiceIds });
            payloads.push({ type: t, cpf, serviceIds: washServiceIds });

            if (carId) {
                payloads.push({ type: t, cpf, washServices: washServiceIds, carId });
                payloads.push({ type: t, cpf, servicesIds: washServiceIds, carId });
                payloads.push({ type: t, cpf, washServicesIds: washServiceIds, carId });
                payloads.push({ type: t, cpf, washServiceIds: washServiceIds, carId });
                payloads.push({ type: t, cpf, serviceIds: washServiceIds, carId });

                payloads.push({ type: t, cpf, washServices: washServiceIds, userCarId: carId });
                payloads.push({ type: t, cpf, servicesIds: washServiceIds, userCarId: carId });
                payloads.push({ type: t, cpf, washServicesIds: washServiceIds, userCarId: carId });
                payloads.push({ type: t, cpf, washServiceIds: washServiceIds, userCarId: carId });
                payloads.push({ type: t, cpf, serviceIds: washServiceIds, userCarId: carId });
            }
        }
    }

    let lastStatus: number | null = null;
    let lastResponse: any = null;

    for (const body of payloads) {
        const r = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);

        const sentKeys = Object.keys(body);
        lastStatus = r.status;
        lastResponse = r.data;

        log("PAYMENT_CREATE", "Tentativa create payment", {
            url: r.url,
            status: r.status,
            sentKeys,
        });

        if (r.status >= 200 && r.status < 300) {
            const paymentId = Number(
                (r.data as any)?.id ?? (r.data as any)?.payment?.id ?? (r.data as any)?.paymentId,
            );
            return {
                ok: true,
                endpoint,
                status: r.status,
                triedPayloadKeys: sentKeys,
                paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
                response: r.data,
            };
        }

        if (r.status !== 400) {
            warn("PAYMENT_CREATE", "Resposta não-200/201 e não-400 (pode ser rota/permissão).", {
                status: r.status,
                data: r.data,
            });
        } else {
            warn("PAYMENT_CREATE", "HTTP 400 (provável validação do DTO). Response body:", r.data);
        }
    }

    const error: any = new Error(
        `Create payment falhou (nenhum payload funcionou). Último HTTP ${lastStatus ?? "?"}`,
    );
    error.response = lastResponse;
    throw error;
}

async function subscribeBestEffort(params: {
    baseUrl: string;
    timeoutMs: number;
    token: string;
    paymentPrefix: string;
    cpf: string;
    planId: number;
    carId: number;
    timeZoneOffset: number;
    userEmailForHolderInfo: string;
}) {
    const { baseUrl, timeoutMs, token, paymentPrefix, cpf, planId, carId, timeZoneOffset, userEmailForHolderInfo } =
        params;

    const endpoint = `${paymentPrefix}/subscribe`; // router.post("/subscribe") dentro do mount "/payment" => "/payment/subscribe"
    const headers = { Authorization: `Bearer ${token}` };

    const typeVariants = ["pix", "PIX", "Pix"];
    const phoneVariants = getPhoneVariants();

    const payloads: Json[] = [];

    /**
     * Similar ao createPayment: adiciona holderInfo + phone para cobrir validação.
     */
    for (const t of typeVariants) {
        for (const phone of phoneVariants) {
            const holderInfo = buildHolderInfo({ cpf, email: userEmailForHolderInfo, phone });

            payloads.push({ type: t, cpf, plan_id: planId, carId, timeZoneOffset, creditCardHolderInfo: holderInfo });
            payloads.push({ type: t, cpf, planId: planId, carId, timeZoneOffset, creditCardHolderInfo: holderInfo });
            payloads.push({
                type: t,
                cpf,
                plan_id: planId,
                userCarId: carId,
                timeZoneOffset,
                creditCardHolderInfo: holderInfo,
            });
            payloads.push({
                type: t,
                cpf,
                planId: planId,
                userCarId: carId,
                timeZoneOffset,
                creditCardHolderInfo: holderInfo,
            });

            payloads.push({
                billingType: t,
                cpf,
                plan_id: planId,
                carId,
                timeZoneOffset,
                creditCardHolderInfo: holderInfo,
            });
            payloads.push({
                billingType: t,
                cpf,
                planId: planId,
                carId,
                timeZoneOffset,
                creditCardHolderInfo: holderInfo,
            });

            // Phone no topo
            payloads.push({ type: t, cpf, plan_id: planId, carId, timeZoneOffset, phone });
            payloads.push({ type: t, cpf, planId: planId, carId, timeZoneOffset, phone });
            payloads.push({ billingType: t, cpf, plan_id: planId, carId, timeZoneOffset, phone });
            payloads.push({ billingType: t, cpf, planId: planId, carId, timeZoneOffset, phone });

            // Mantém tentativas antigas por último
            payloads.push({ type: t, cpf, plan_id: planId, carId, timeZoneOffset });
            payloads.push({ type: t, cpf, planId: planId, carId, timeZoneOffset });
            payloads.push({ type: t, cpf, plan_id: planId, userCarId: carId, timeZoneOffset });
            payloads.push({ type: t, cpf, planId: planId, userCarId: carId, timeZoneOffset });

            payloads.push({ billingType: t, cpf, plan_id: planId, carId, timeZoneOffset });
            payloads.push({ billingType: t, cpf, planId: planId, carId, timeZoneOffset });
        }
    }

    let lastStatus: number | null = null;
    let lastResponse: any = null;

    for (const body of payloads) {
        const r = await httpRequest(baseUrl, endpoint, "POST", body, timeoutMs, headers);

        lastStatus = r.status;
        lastResponse = r.data;

        log("SUBSCRIBE", "Tentativa subscribe", {
            url: r.url,
            status: r.status,
            sentKeys: Object.keys(body),
        });

        if (r.status >= 200 && r.status < 300) {
            const subscriptionId = Number((r.data as any)?.subscription?.id ?? (r.data as any)?.id);
            const paymentId = Number((r.data as any)?.payment?.id ?? (r.data as any)?.paymentId);

            return {
                ok: true,
                endpoint,
                status: r.status,
                triedPayloadKeys: Object.keys(body),
                subscriptionId: subscriptionId && !Number.isNaN(subscriptionId) ? subscriptionId : null,
                paymentId: paymentId && !Number.isNaN(paymentId) ? paymentId : null,
                response: r.data,
            };
        }

        if (r.status === 400) {
            warn("SUBSCRIBE", "HTTP 400 (provável validação do DTO). Response body:", r.data);
        }
    }

    const error: any = new Error(
        `Subscribe falhou (nenhum payload funcionou). Último HTTP ${lastStatus ?? "?"}`,
    );
    error.response = lastResponse;
    throw error;
}

async function paymentDetailsBestEffort(params: {
    baseUrl: string;
    timeoutMs: number;
    token: string;
    paymentPrefix: string;
    paymentId: number;
}) {
    const { baseUrl, timeoutMs, token, paymentPrefix, paymentId } = params;

    const headers = { Authorization: `Bearer ${token}` };

    const candidates = [
        `${paymentPrefix}/detail/${paymentId}`,
        `${paymentPrefix}/detailed-payments/${paymentId}`,
        `${paymentPrefix}/payments/${paymentId}`,
        `${paymentPrefix}/${paymentId}`,
    ];

    for (const path of candidates) {
        const r = await httpRequest(baseUrl, path, "GET", null, timeoutMs, headers);
        log("PAYMENT_DETAILS", "Tentativa buscar detalhes do payment", { url: r.url, status: r.status });

        if (r.status === 404) continue;

        if (r.status >= 200 && r.status < 300) {
            return {
                ok: true,
                path,
                status: r.status,
                response: r.data,
            };
        }
    }

    return {
        ok: false,
        reason: "Nenhuma rota de detalhes respondeu 2xx (possível: rota exige outro path/permissão).",
        tried: candidates,
    };
}

async function bestEffortCleanup(
    prisma: PrismaClient,
    ctx: {
        createdUserId: number | null;
        createdCarId: number | null;
        createdPaymentIds: number[];
        createdSubscriptionIds: number[];
        createdIndividualPurchaseIds: number[];
    },
) {
    log("CLEANUP", "Iniciando cleanup best-effort...", ctx);

    try {
        if (ctx.createdIndividualPurchaseIds.length > 0) {
            const deleted = await (prisma as any).individualServicePurchase.deleteMany({
                where: { id: { in: ctx.createdIndividualPurchaseIds } },
            });
            log("CLEANUP", "individualServicePurchase.deleteMany OK", deleted);
        } else if (ctx.createdPaymentIds.length > 0) {
            const deleted = await (prisma as any).individualServicePurchase.deleteMany({
                where: { paymentId: { in: ctx.createdPaymentIds } },
            });
            log("CLEANUP", "individualServicePurchase.deleteMany (by paymentId) OK", deleted);
        }
    } catch (e: any) {
        warn("CLEANUP", "Falha ao deletar IndividualServicePurchase (prisma).", { message: e?.message });
        try {
            if (ctx.createdPaymentIds.length > 0) {
                const deletedRaw = await prisma.$executeRawUnsafe(
                    `DELETE FROM "IndividualServicePurchase" WHERE "paymentId" = ANY($1::int[])`,
                    ctx.createdPaymentIds,
                );
                log("CLEANUP", "IndividualServicePurchase DELETE OK (raw)", { deletedRaw });
            }
        } catch (e2: any) {
            warn("CLEANUP", "Falha ao deletar IndividualServicePurchase (raw).", { message: e2?.message });
        }
    }

    try {
        if (ctx.createdPaymentIds.length > 0) {
            const deleted = await (prisma as any).payment.deleteMany({
                where: { id: { in: ctx.createdPaymentIds } },
            });
            log("CLEANUP", "payment.deleteMany OK", deleted);
        }
    } catch (e: any) {
        warn("CLEANUP", "Falha ao deletar Payment (prisma).", { message: e?.message });
        try {
            if (ctx.createdPaymentIds.length > 0) {
                const deletedRaw = await prisma.$executeRawUnsafe(
                    `DELETE FROM "Payment" WHERE "id" = ANY($1::int[])`,
                    ctx.createdPaymentIds,
                );
                log("CLEANUP", "Payment DELETE OK (raw)", { deletedRaw });
            }
        } catch (e2: any) {
            warn("CLEANUP", "Falha ao deletar Payment (raw).", { message: e2?.message });
        }
    }

    try {
        if (ctx.createdSubscriptionIds.length > 0) {
            const deleted = await (prisma as any).subscription.deleteMany({
                where: { id: { in: ctx.createdSubscriptionIds } },
            });
            log("CLEANUP", "subscription.deleteMany OK", deleted);
        }
    } catch (e: any) {
        warn("CLEANUP", "Falha ao deletar Subscription (prisma).", { message: e?.message });
        try {
            if (ctx.createdSubscriptionIds.length > 0) {
                const deletedRaw = await prisma.$executeRawUnsafe(
                    `DELETE FROM "Subscription" WHERE "id" = ANY($1::int[])`,
                    ctx.createdSubscriptionIds,
                );
                log("CLEANUP", "Subscription DELETE OK (raw)", { deletedRaw });
            }
        } catch (e2: any) {
            warn("CLEANUP", "Falha ao deletar Subscription (raw).", { message: e2?.message });
        }
    }

    if (ctx.createdCarId) {
        const carId = ctx.createdCarId;
        const clientAny = prisma as any;

        try {
            if (clientAny.userCar?.delete) {
                await clientAny.userCar.delete({ where: { id: carId } });
                log("CLEANUP", "userCar.delete OK", { id: carId });
            } else if (clientAny.car?.delete) {
                await clientAny.car.delete({ where: { id: carId } });
                log("CLEANUP", "car.delete OK", { id: carId });
            } else {
                throw new Error("Nenhum model car/userCar com delete disponível.");
            }
        } catch (e: any) {
            warn("CLEANUP", "Falha ao deletar Car (prisma). Tentando raw...", { message: e?.message });
            try {
                const deletedRaw1 = await prisma.$executeRawUnsafe(
                    `DELETE FROM "UserCar" WHERE "id" = $1`,
                    carId,
                );
                log("CLEANUP", "UserCar DELETE OK (raw)", { deletedRaw1 });
            } catch (e2: any) {
                warn("CLEANUP", "Falha ao deletar UserCar (raw).", { message: e2?.message });
            }
        }
    }

    if (ctx.createdUserId) {
        const userId = ctx.createdUserId;

        try {
            await prisma.user.delete({ where: { id: userId } as any });
            log("CLEANUP", "User.delete OK", { id: userId });
        } catch (e: any) {
            warn("CLEANUP", "User.delete falhou; tentando soft-delete (se houver deletedAt).", { message: e?.message });
            try {
                await prisma.user.update({
                    where: { id: userId } as any,
                    data: { deletedAt: new Date() } as any,
                });
                log("CLEANUP", "User soft-delete OK", { id: userId });
            } catch (e2: any) {
                warn("CLEANUP", "Soft-delete falhou também.", { message: e2?.message });
            }
        }

        try {
            const stillUser = await prisma.user.findUnique({
                where: { id: userId } as any,
                select: { id: true, deletedAt: true } as any,
            });

            log("CLEANUP", "Verificação pós-cleanup", {
                userExists: Boolean(stillUser),
                userDeletedAt: (stillUser as any)?.deletedAt ?? null,
            });
        } catch (e: any) {
            warn("CLEANUP", "Falha ao verificar pós-cleanup.", { message: e?.message });
        }
    }

    log("CLEANUP", "Cleanup finalizado.");
}

async function runStep(report: SmokeReport, name: string, fn: () => Promise<any>) {
    const started = Date.now();
    const startedAt = nowIso();

    try {
        const details = await fn();
        const endedAt = nowIso();
        report.steps.push({
            name,
            ok: true,
            startedAt,
            endedAt,
            durationMs: msSince(started),
            details,
        });
        return details;
    } catch (e: any) {
        const endedAt = nowIso();
        report.steps.push({
            name,
            ok: false,
            startedAt,
            endedAt,
            durationMs: msSince(started),
            error: {
                message: e?.message,
                stack: e?.stack,
                response: e?.response ?? null,
            },
        });
        throw e;
    }
}

async function main() {
    const args = parseArgs(process.argv);

    const baseUrl = (args["base-url"] as string) || process.env.SMOKE_BASE_URL || "http://localhost:3000";
    const pingPath = (args["ping-path"] as string) || "/";
    const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 15000;

    const registerPath = (args["register-path"] as string) || "/auth/register";
    const loginPath = (args["login-path"] as string) || "/auth/login";

    const listPlansPath = (args["list-plans-path"] as string) || "/plans";
    const listWashServicesPath = (args["list-wash-services-path"] as string) || "/wash-services";

    const preferredCarPath = (args["create-car-path"] as string) || ""; // opcional
    const timeZoneOffset = args["timeZoneOffset"] ? Number(args["timeZoneOffset"]) : -180;

    const dbUrl = (args["db-url"] as string) || process.env.DATABASE_URL || "";
    if (!dbUrl) {
        throw new Error("DATABASE_URL não informado. Configure no .env ou passe --db-url=...");
    }

    const smokeReport: SmokeReport = {
        startedAt: nowIso(),
        ok: false,
        context: {
            baseUrl,
            pingPath,
            timeoutMs,
            registerPath,
            loginPath,
            listPlansPath,
            listWashServicesPath,
            timeZoneOffset,
            preferredCarPath: preferredCarPath || null,
            databaseUrl: sanitizeDbUrl(dbUrl),
            paymentModuleMountExpected: "/payment",
        },
        steps: [],
    };

    log("INIT", "=== Smoke Test: Payments Phase 1 + Phase 2 (com cleanup) ===");
    log("INIT", "Config", smokeReport.context);

    const prisma = new PrismaClient({
        datasources: { db: { url: dbUrl } },
    });

    const ctx = {
        createdUserId: null as number | null,
        createdCarId: null as number | null,
        createdPaymentIds: [] as number[],
        createdSubscriptionIds: [] as number[],
        createdIndividualPurchaseIds: [] as number[],
    };

    let failError: any = null;

    try {
        await runStep(smokeReport, "Ping API", async () => {
            await pingBaseUrl(baseUrl, pingPath, Math.min(timeoutMs, 8000));
            return { ok: true };
        });

        await runStep(smokeReport, "DB Healthcheck", async () => {
            await dbHealthCheck(prisma);
            return { ok: true };
        });

        const user = await runStep(smokeReport, "Register + Login", async () => {
            const cpf = await generateUniqueCpf(prisma);
            const email = generateUniqueEmail();
            const password = "123456";

            const registerBody: Json = {
                name: "Smoke Payments Phase1+2",
                email,
                password,
                phone: "11999999999",
                cpf,
            };

            const registerResp = await httpRequest(baseUrl, registerPath, "POST", registerBody, timeoutMs);
            if (registerResp.status !== 201) {
                throw new Error(
                    `Register falhou. HTTP ${registerResp.status}. Body: ${JSON.stringify(registerResp.data)}`,
                );
            }

            const newUserId = Number((registerResp.data as any)?.user?.id);
            if (!newUserId || Number.isNaN(newUserId)) {
                throw new Error("Register não retornou user.id válido.");
            }

            const loginResp = await httpRequest(baseUrl, loginPath, "POST", { email, password }, timeoutMs);
            if (loginResp.status !== 200) {
                throw new Error(
                    `Login falhou. HTTP ${loginResp.status}. Body: ${JSON.stringify(loginResp.data)}`,
                );
            }

            const token = String((loginResp.data as any)?.token || "");
            if (!token) throw new Error("Login não retornou token.");

            ctx.createdUserId = newUserId;

            return {
                userId: newUserId,
                email,
                cpf,
                tokenPrefix: `${token.slice(0, 10)}***`,
                token,
            };
        });

        const token: string = user.token;
        const cpf: string = user.cpf;
        const email: string = user.email;

        const paymentPrefix = await runStep(smokeReport, "Resolver prefix do módulo payment", async () => {
            const prefix = await resolvePaymentPrefix(baseUrl, timeoutMs);
            return { prefix };
        });

        const resources = await runStep(smokeReport, "Selecionar Plan + WashServices (DB)", async () => {
            const selectedPlan = await selectPlanPreferDb(prisma);
            if (!selectedPlan?.id) {
                throw new Error("Não consegui selecionar um Plan via DB.");
            }

            const services = await selectWashServicesPreferDb(prisma, 2);
            if (!services.length) {
                throw new Error(
                    "Não encontrei WashServices (isPublished=true & isAvailable=true) via DB. Verifique seed/publicação.",
                );
            }

            const washServiceIds = services
                .map((s: any) => Number(s.id))
                .filter((n: number) => !Number.isNaN(n) && n > 0);

            if (!washServiceIds.length) throw new Error("WashServices encontrados não têm IDs válidos.");

            return { selectedPlan, services, washServiceIds };
        });

        const selectedPlan = resources.selectedPlan;
        const washServiceIds: number[] = resources.washServiceIds;

        await runStep(smokeReport, "Criar Car (API ou DB fallback)", async () => {
            const created = await createCarBestEffort({
                baseUrl,
                timeoutMs,
                token,
                prisma,
                userId: ctx.createdUserId!,
                preferredPath: preferredCarPath || undefined,
            });

            ctx.createdCarId = created.id;

            return {
                origin: created.origin,
                id: created.id,
                plate: created.plate,
                path: (created as any).path ?? null,
                model: (created as any).model ?? null,
            };
        });

        await runStep(smokeReport, "PHASE 1: Create Payment (avulso)", async () => {
            const created = await createPaymentBestEffort({
                baseUrl,
                timeoutMs,
                token,
                paymentPrefix: paymentPrefix.prefix,
                cpf,
                washServiceIds,
                carId: ctx.createdCarId,
                userEmailForHolderInfo: email,
            });

            const paymentId = Number(created.paymentId);
            if (paymentId && !Number.isNaN(paymentId)) ctx.createdPaymentIds.push(paymentId);

            const purchases = (created.response as any)?.individualPurchases;
            if (Array.isArray(purchases)) {
                for (const p of purchases) {
                    const id = Number(p?.id);
                    if (id && !Number.isNaN(id)) ctx.createdIndividualPurchaseIds.push(id);
                }
            }

            return {
                endpoint: created.endpoint,
                status: created.status,
                paymentId: created.paymentId,
                triedPayloadKeys: created.triedPayloadKeys,
                response: created.response,
            };
        });

        await runStep(smokeReport, "PHASE 1B: Get Payment Details (best-effort)", async () => {
            const pid = ctx.createdPaymentIds[0];
            if (!pid) {
                return { skipped: true, reason: "paymentId não disponível no retorno do createPayment." };
            }

            const details = await paymentDetailsBestEffort({
                baseUrl,
                timeoutMs,
                token,
                paymentPrefix: paymentPrefix.prefix,
                paymentId: pid,
            });

            return details;
        });

        await runStep(smokeReport, "PHASE 2: Subscribe To Plan", async () => {
            if (!ctx.createdCarId) throw new Error("carId não disponível (não foi possível criar carro).");

            const result = await subscribeBestEffort({
                baseUrl,
                timeoutMs,
                token,
                paymentPrefix: paymentPrefix.prefix,
                cpf,
                planId: Number(selectedPlan.id),
                carId: ctx.createdCarId,
                timeZoneOffset,
                userEmailForHolderInfo: email,
            });

            if (result.subscriptionId) ctx.createdSubscriptionIds.push(result.subscriptionId);
            if (result.paymentId) ctx.createdPaymentIds.push(result.paymentId);

            return {
                endpoint: result.endpoint,
                status: result.status,
                subscriptionId: result.subscriptionId,
                paymentId: result.paymentId,
                triedPayloadKeys: result.triedPayloadKeys,
                response: result.response,
            };
        });

        await runStep(smokeReport, "WEBHOOK (opcional, se ASAAS_ACCESS_TOKEN existir)", async () => {
            const asaasToken = process.env.ASAAS_ACCESS_TOKEN;
            if (!asaasToken || !asaasToken.trim()) {
                return { skipped: true, reason: "ASAAS_ACCESS_TOKEN não encontrado localmente" };
            }

            const webhookPath = `${paymentPrefix.prefix}/payments-webhook`; // router.post("/payments-webhook") dentro do mount "/payment"

            const syntheticWebhook: Json = {
                event: "PAYMENT_UPDATED",
                payment: {
                    id: "pay_smoke_synthetic",
                    value: 1,
                    status: "PENDING",
                    externalReference: JSON.stringify({
                        userId: ctx.createdUserId,
                        planId: Number(selectedPlan.id),
                        subId: ctx.createdSubscriptionIds[0] ?? null,
                    }),
                    billingType: "PIX",
                    paymentDate: new Date().toISOString(),
                },
            };

            const whResp = await httpRequest(baseUrl, webhookPath, "POST", syntheticWebhook, timeoutMs, {
                "asaas-access-token": asaasToken,
            });

            return { webhookPath, status: whResp.status, response: whResp.data };
        });

        smokeReport.ok = true;
        return;
    } catch (e: any) {
        failError = e;
        smokeReport.ok = false;
        smokeReport.failReason = e?.message ?? "Falha desconhecida";
    } finally {
        try {
            await bestEffortCleanup(prisma, ctx);
        } catch (e: any) {
            err("CLEANUP", "Cleanup falhou (atenção: pode ter sobrado resíduo).", { message: e?.message });
            if (!smokeReport.failReason) {
                smokeReport.failReason = `Cleanup falhou: ${e?.message ?? "desconhecido"}`;
            }
            smokeReport.ok = false;
        } finally {
            await prisma.$disconnect();
        }

        smokeReport.endedAt = nowIso();

        const summary = {
            ok: smokeReport.ok,
            failReason: smokeReport.failReason ?? null,
            startedAt: smokeReport.startedAt,
            endedAt: smokeReport.endedAt,
            context: smokeReport.context,
            steps: smokeReport.steps.map((s) => ({
                name: s.name,
                ok: s.ok,
                durationMs: s.durationMs,
                details: s.ok ? s.details : undefined,
                error: s.ok ? undefined : s.error,
            })),
            created: {
                userId: ctx.createdUserId,
                carId: ctx.createdCarId,
                paymentIds: ctx.createdPaymentIds,
                subscriptionIds: ctx.createdSubscriptionIds,
                individualPurchaseIds: ctx.createdIndividualPurchaseIds,
            },
        };

        console.log(
            "\n==================== RESULTADO DO SMOKE (PAYMENTS PHASE 1 + PHASE 2) ====================",
        );
        console.log(JSON.stringify(summary, null, 2));
        console.log("===================================================================================\n");

        if (failError) {
            process.exitCode = 1;
        }
    }
}

main().catch((e: any) => {
    err("FATAL", "Erro fatal inesperado no script.", { message: e?.message, stack: e?.stack });
    process.exitCode = 1;
});
