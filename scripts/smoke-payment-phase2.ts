/* eslint-disable no-console */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

type Json = Record<string, any>;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function nowIso(): string {
    return new Date().toISOString();
}

function log(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}]`;
    if (data !== undefined) console.log(prefix, message, data);
    else console.log(prefix, message);
}

function warn(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}] [WARN]`;
    if (data !== undefined) console.warn(prefix, message, data);
    else console.warn(prefix, message);
}

function err(step: string, message: string, data?: any) {
    const prefix = `[${nowIso()}] [${step}] [ERROR]`;
    if (data !== undefined) console.error(prefix, message, data);
    else console.error(prefix, message);
}

function assert(condition: any, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertNotNull<T>(value: T | null | undefined, message: string): asserts value is T {
    if (value === null || value === undefined) throw new Error(message);
}

function safeJsonStringify(v: any): string {
    try {
        return JSON.stringify(v, null, 2);
    } catch {
        return String(v);
    }
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

function normalizeBaseUrl(baseUrl: string): string {
    return String(baseUrl || "").replace(/\/$/, "");
}

function buildUrl(baseUrl: string, path: string): string {
    const base = normalizeBaseUrl(baseUrl);
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base}${p}`;
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

function unwrapCustomJson(payload: any) {
    if (!payload || typeof payload !== "object") return payload;
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return (payload as any).data;
    return payload;
}

function extractToken(payloadRaw: any): string | null {
    const payload = unwrapCustomJson(payloadRaw);
    if (!payload || typeof payload !== "object") return null;

    return (
        (payload as any).token ||
        (payload as any).accessToken ||
        (payload as any).access_token ||
        (payload as any).jwt ||
        (payload as any)?.data?.token ||
        null
    );
}

async function httpRequest(opts: {
    baseUrl: string;
    path: string;
    method: HttpMethod;
    timeoutMs: number;
    token?: string | null;
    body?: Json | null;
    headers?: Record<string, string>;
}) {
    const url = buildUrl(opts.baseUrl, opts.path);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    const headers: Record<string, string> = {
        ...(opts.headers || {}),
    };

    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

    let body: string | undefined = undefined;
    if (opts.body !== undefined && opts.body !== null) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
    }

    try {
        const resp = await fetch(url, {
            method: opts.method,
            headers,
            body,
            signal: controller.signal,
        });

        const contentType = resp.headers.get("content-type") || "";
        let data: any = null;

        if (contentType.includes("application/json")) {
            try {
                data = await resp.json();
            } catch {
                data = null;
            }
        } else {
            try {
                data = await resp.text();
            } catch {
                data = null;
            }
        }

        return { ok: resp.ok, status: resp.status, data, url };
    } catch (e: any) {
        err("HTTP", "Falha de conexão ao chamar endpoint (fetch).", {
            url,
            method: opts.method,
            error: describeFetchError(e),
        });
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

async function pingBaseUrl(baseUrl: string, pingPath: string, timeoutMs: number) {
    log("PING", "Pingando API para validar conectividade...", { baseUrl, pingPath, timeoutMs });

    const r = await httpRequest({
        baseUrl,
        path: pingPath,
        method: "GET",
        body: null,
        timeoutMs,
    });

    log("PING", "Ping OK (conectou).", {
        url: r.url,
        status: r.status,
        obs: "Status pode ser 200/401/404; o importante é conectar.",
    });

    return r;
}

async function dbHealthCheck(prisma: PrismaClient) {
    log("DB", "Rodando healthcheck do banco (SELECT 1)...");

    try {
        const r = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 as ok`);
        log("DB", "DB healthcheck OK.", { result: r?.[0] ?? null });
    } catch (e: any) {
        err("DB", "DB healthcheck FAIL: não foi possível conectar no banco.", { message: e?.message });
        throw e;
    }
}

function randInt(maxExclusive: number): number {
    return crypto.randomInt(0, maxExclusive);
}

function randLetters(n: number): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let out = "";
    for (let i = 0; i < n; i++) out += letters[randInt(letters.length)];
    return out;
}

function randDigits(n: number): string {
    const digits = "0123456789";
    let out = "";
    for (let i = 0; i < n; i++) out += digits[randInt(digits.length)];
    return out;
}

/**
 * Placas válidas conforme o padrão que você já usa:
 * - AAA9999
 * - AAA9A99 (Mercosul)
 */
function generateValidPlate(preferMercosul = true): string {
    if (preferMercosul) {
        // AAA9A99
        return `${randLetters(3)}${randDigits(1)}${randLetters(1)}${randDigits(2)}`;
    }
    // AAA9999
    return `${randLetters(3)}${randDigits(4)}`;
}

/**
 * CPF válido (11 dígitos).
 */
function generateValidCpf(): string {
    const n: number[] = [];
    for (let i = 0; i < 9; i++) n.push(randInt(10));

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

function generateUniqueEmail(prefix: string): string {
    const ts = Date.now();
    const r = crypto.randomBytes(6).toString("hex");
    return `${prefix}.${ts}.${r}@example.com`.toLowerCase();
}

/**
 * Telefones válidos (bem conservador): 11 dígitos (DDD + número).
 * Ex.: 11999999999
 */
function generateValidPhone11Digits(): string {
    // DDD fixo 11 (SP) + 9xxxxxxxx
    return `11${randDigits(9)}`;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    process.stdout.write(`\n[STEP] ${name}\n`);
    try {
        const out = await fn();
        process.stdout.write(`[OK]   ${name}\n`);
        return out;
    } catch (e: any) {
        process.stdout.write(`[FAIL] ${name}\n`);
        throw e;
    }
}

/**
 * Seleciona um plano "package" pelo DB, para usar no subscribe.
 */
async function selectPlanForSubscribe(prisma: PrismaClient, preferredPlanId?: number) {
    if (preferredPlanId && Number.isFinite(preferredPlanId)) {
        const plan = await (prisma as any).plan.findUnique({ where: { id: preferredPlanId } });
        assert(plan, `Plan não encontrado no DB para id=${preferredPlanId}`);
        return plan;
    }

    const plan = await (prisma as any).plan.findFirst({
        where: {
            isPackage: true,
        },
        orderBy: { id: "asc" },
    });

    assert(plan, "Não encontrei nenhum plano (isPackage=true) no DB para testar o subscribe.");
    return plan;
}

/**
 * Descobre wash services publicados/ativos no DB (para uso opcional).
 */
async function selectWashServices(prisma: PrismaClient, preferredIds: number[]) {
    if (preferredIds.length > 0) {
        const services = await (prisma as any).washService.findMany({
            where: { id: { in: preferredIds } },
            orderBy: { id: "asc" },
        });
        const ids = services.map((s: any) => Number(s.id)).filter((n: number) => Number.isFinite(n));
        return { services, ids };
    }

    const services = await (prisma as any).washService.findMany({
        where: {
            isPublished: true,
            isAvailable: true,
        },
        orderBy: { id: "asc" },
        take: 2,
    });

    const ids = services.map((s: any) => Number(s.id)).filter((n: number) => Number.isFinite(n));
    return { services, ids };
}

async function registerUser(baseUrl: string, registerPath: string, timeoutMs: number, payload: Json) {
    const r = await httpRequest({
        baseUrl,
        path: registerPath,
        method: "POST",
        body: payload,
        timeoutMs,
    });

    if (r.status !== 201) {
        throw new Error(
            `Register falhou. HTTP ${r.status}\nURL=${r.url}\nBody=${safeJsonStringify(r.data)}`
        );
    }

    const out = unwrapCustomJson(r.data);
    const user = (out as any)?.user ?? (out as any)?.data?.user ?? out ?? null;

    return { raw: r, out, user };
}

async function loginUser(baseUrl: string, loginPath: string, timeoutMs: number, email: string, password: string) {
    const r = await httpRequest({
        baseUrl,
        path: loginPath,
        method: "POST",
        body: { email, password },
        timeoutMs,
    });

    if (!r.ok) {
        throw new Error(
            `Login falhou. HTTP ${r.status}\nURL=${r.url}\nBody=${safeJsonStringify(r.data)}`
        );
    }

    const token = extractToken(r.data);
    if (!token) {
        throw new Error(`Login OK, mas não encontrei token no retorno.\nBody=${safeJsonStringify(r.data)}`);
    }

    return { token, raw: r };
}

async function createCar(baseUrl: string, token: string, timeoutMs: number) {
    // tenta Mercosul primeiro, depois normal
    const plate1 = generateValidPlate(true);
    const plate2 = generateValidPlate(false);

    const candidates = [
        { licensePlate: plate1, color: "Preto", model: "Civic", brand: "Honda", year: 2022 },
        { licensePlate: plate2, color: "Preto", model: "Civic", brand: "Honda", year: 2022 },
    ];

    let last: any = null;

    for (const body of candidates) {
        const r = await httpRequest({
            baseUrl,
            path: "/user-car",
            method: "POST",
            token,
            body,
            timeoutMs,
        });

        last = r;

        const candidateCar = unwrapCustomJson(r.data);
        if (r.ok && (candidateCar as any)?.id) {
            return { car: candidateCar, raw: r };
        }

        // tenta próxima placa em caso de 400/409/422
        if ([400, 409, 422].includes(r.status)) continue;

        break;
    }

    throw new Error(
        `Falha ao criar carro. Status=${last?.status}\nBody=${safeJsonStringify(last?.data)}`
    );
}

async function deleteUserBestEffort(prisma: PrismaClient, userId: number) {
    try {
        await prisma.user.delete({ where: { id: userId } });
        log("CLEANUP", "User.delete OK", { id: userId });
    } catch (e: any) {
        warn("CLEANUP", "User.delete falhou; tentando soft-delete.", { message: e?.message, id: userId });
        try {
            await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
            log("CLEANUP", "User soft-delete OK (deletedAt setado)", { id: userId });
        } catch (e2: any) {
            err("CLEANUP", "Falha também no soft-delete do usuário.", { message: e2?.message, id: userId });
            throw e2;
        }
    }
}

async function cleanupPaymentsAndSubscriptionsBestEffort(prisma: PrismaClient, userId: number) {
    // Ordem intencional para evitar FK:
    // 1) IndividualServicePurchase (depende de Payment)
    // 2) Payment
    // 3) Subscription
    try {
        const deletedPurchases = await (prisma as any).individualServicePurchase?.deleteMany?.({ where: { userId } });
        if (deletedPurchases) log("CLEANUP", "individualServicePurchase.deleteMany OK", { deletedPurchases });
    } catch (e: any) {
        warn("CLEANUP", "individualServicePurchase.deleteMany falhou (best-effort).", { message: e?.message });
    }

    try {
        const deletedPayments = await (prisma as any).payment.deleteMany({ where: { userId } });
        log("CLEANUP", "payment.deleteMany OK", { deletedPayments });
    } catch (e: any) {
        warn("CLEANUP", "payment.deleteMany falhou (best-effort).", { message: e?.message });
    }

    try {
        const deletedSubs = await (prisma as any).subscription.deleteMany({ where: { userId } });
        log("CLEANUP", "subscription.deleteMany OK", { deletedSubs });
    } catch (e: any) {
        warn("CLEANUP", "subscription.deleteMany falhou (best-effort).", { message: e?.message });
    }
}

async function deleteCarByDbBestEffort(prisma: PrismaClient, carId: number) {
    try {
        await (prisma as any).car.delete({ where: { id: carId } });
        log("CLEANUP", "car.delete (DB) OK", { id: carId });
    } catch (e: any) {
        warn("CLEANUP", "car.delete (DB) falhou (best-effort).", { message: e?.message, id: carId });
    }
}

async function main() {
    const args = parseArgs(process.argv);

    const baseUrl = normalizeBaseUrl((args["base-url"] as string) || process.env.SMOKE_BASE_URL || "http://localhost:3002");
    const pingPath = (args["ping-path"] as string) || "/";
    const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 15000;

    const registerPath = (args["register-path"] as string) || "/auth/register";
    const loginPath = (args["login-path"] as string) || "/auth/login";

    const paymentMount = (args["payment-mount"] as string) || "/payment";
    const subscribePath = (args["subscribe-path"] as string) || `${paymentMount}/subscribe`;

    const timeZoneOffset = args["tz-offset"] ? Number(args["tz-offset"]) : -180;

    const dbUrl = (args["db-url"] as string) || process.env.DATABASE_URL || "";
    if (!dbUrl) throw new Error("DATABASE_URL não informado. Configure no .env ou passe --db-url=...");

    const preferredPlanId = args["plan-id"] ? Number(args["plan-id"]) : undefined;

    const washServiceIdsArg =
        String(args["wash-service-ids"] || process.env.WASH_SERVICE_IDS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n > 0);

    const cleanup = String(args["cleanup"] ?? process.env.CLEANUP ?? "true").toLowerCase() === "true";

    // IMPORTANTE:
    // - Por padrão, NÃO testamos payment avulso na Fase 2, porque o endpoint /payment exige "value"
    // - Para rodar o avulso, use: --include-avulso=true
    const includeAvulso = String(args["include-avulso"] ?? process.env.INCLUDE_AVULSO ?? "false").toLowerCase() === "true";

    log("INIT", "=== Smoke Test: Payments Phase 2 (subscribe) + cleanup ===");
    log("INIT", "Config", {
        baseUrl,
        pingPath,
        timeoutMs,
        registerPath,
        loginPath,
        paymentMount,
        subscribePath,
        timeZoneOffset,
        preferredPlanId: preferredPlanId ?? null,
        washServiceIdsArg,
        cleanup,
        includeAvulso,
    });
    log("INIT", "DATABASE_URL (sanitizado)", sanitizeDbUrl(dbUrl));

    const prisma = new PrismaClient({
        datasources: { db: { url: dbUrl } },
    });

    let createdUserId: number | undefined = undefined;
    let createdCarId: number | undefined = undefined;
    let createdUserEmail: string | undefined = undefined;
    let createdUserCpf: string | undefined = undefined;
    let authToken: string | undefined = undefined;

    try {
        await step("Ping API", async () => {
            await pingBaseUrl(baseUrl, pingPath, Math.min(timeoutMs, 8000));
        });

        await step("DB Healthcheck", async () => {
            await dbHealthCheck(prisma);
        });

        const selectedPlan = await step("Selecionar Plan (DB)", async () => {
            const plan = await selectPlanForSubscribe(prisma, preferredPlanId);
            log("PLAN", "Plan selecionado", {
                id: plan.id,
                name: plan.name,
                price: plan.price,
                duration: plan.duration,
                isPackage: plan.isPackage,
                periodicityType: plan.periodicityType,
                extraMonths: plan.extraMonths,
                maxInstallments: plan.maxInstallments,
            });
            return plan;
        });

        const selectedWashServices = await step("Selecionar WashServices (DB) (opcional)", async () => {
            const { services, ids } = await selectWashServices(prisma, washServiceIdsArg);
            log("WASH", "WashServices selecionados", {
                services: services.map((s: any) => ({ id: s.id, name: s.name, price: s.price })),
                ids,
            });
            return { services, ids };
        });

        const userEmail = generateUniqueEmail("smoke.payments.phase2");
        const userCpf = generateValidCpf();
        const userPhone = generateValidPhone11Digits();
        const userPassword = "123456";

        createdUserEmail = userEmail;
        createdUserCpf = userCpf;

        await step("Register (criar usuário)", async () => {
            const payload = {
                name: "Smoke Payments Phase2",
                email: userEmail,
                password: userPassword,
                phone: userPhone,
                cpf: userCpf,
            };

            log("REGISTER", "Request register", { ...payload, password: "***" });

            const { user } = await registerUser(baseUrl, registerPath, timeoutMs, payload);

            const newUserId = Number((user as any)?.id);
            assert(Number.isFinite(newUserId) && newUserId > 0, "Register não retornou user.id válido.");

            createdUserId = newUserId;

            log("REGISTER", "Usuário criado", { id: createdUserId, email: userEmail, cpf: userCpf, phone: userPhone });
            return user;
        });

        await step("Login", async () => {
            const { token } = await loginUser(baseUrl, loginPath, timeoutMs, userEmail, userPassword);
            authToken = token;
            log("LOGIN", "Token obtido", { tokenPrefix: `${token.slice(0, 12)}***` });
            return token;
        });

        await step("Criar Car (API)", async () => {
            assertNotNull(authToken, "Token não disponível para criar o carro.");
            const { car } = await createCar(baseUrl, authToken, timeoutMs);

            const carId = Number((car as any)?.id);
            assert(Number.isFinite(carId) && carId > 0, "Car criado sem id válido.");

            createdCarId = carId;

            log("CAR", "Car criado", { id: createdCarId, licensePlate: (car as any)?.licensePlate });
            return car;
        });

        await step("PHASE 2: Subscribe (POST /payment/subscribe)", async () => {
            assertNotNull(authToken, "Token não disponível para o subscribe.");
            assertNotNull(createdUserCpf, "CPF do usuário não disponível para o subscribe.");
            assertNotNull(createdCarId, "CarId não disponível para o subscribe.");

            const payload: Json = {
                plan_id: Number((selectedPlan as any).id),
                carId: createdCarId,
                type: "pix",
                cpf: createdUserCpf,
                timeZoneOffset,
            };

            log("SUBSCRIBE", "Request subscribe", payload);

            const r = await httpRequest({
                baseUrl,
                path: subscribePath,
                method: "POST",
                token: authToken,
                body: payload,
                timeoutMs,
            });

            log("SUBSCRIBE", "Resposta subscribe", {
                url: r.url,
                status: r.status,
                body: unwrapCustomJson(r.data),
            });

            if (!r.ok) {
                throw new Error(
                    `Subscribe falhou. HTTP ${r.status}\nURL=${r.url}\nBody=${safeJsonStringify(r.data)}`
                );
            }

            const out = unwrapCustomJson(r.data);

            const subscription = (out as any)?.subscription ?? (out as any)?.data?.subscription ?? null;
            const payment = (out as any)?.payment ?? (out as any)?.data?.payment ?? null;

            assert(subscription && (subscription as any)?.id, "Subscribe não retornou subscription.id");

            log("SUBSCRIBE", "OK: subscription criada", {
                subscriptionId: (subscription as any).id,
                isActive: (subscription as any).isActive,
                subscriptionStatus: (subscription as any).subscriptionStatus,
                planId: (subscription as any).planId,
                planType: (subscription as any).planType,
                expiresAt: (subscription as any).expiresAt,
                hasPayment: Boolean(payment),
                paymentStatus: payment?.status,
                paymentIdAsaas: payment?.paymentIdAsaas,
            });

            const planType = String((subscription as any)?.planType || "").toUpperCase();
            assert(
                !["MONTHLY", "YEARLY", "QUARTERLY", "SEMIANNUALLY", "WEEKLY"].includes(planType),
                `planType parece string externa do ASAAS (não deveria persistir): ${(subscription as any)?.planType}`
            );

            // Assert mínimo de payment no subscribe
            assert(payment && payment?.status, "Subscribe não retornou payment no payload (esperado para Fase 2).");
        });

        // Payment avulso NÃO pertence à Fase 2: por padrão fica desligado.
        // Se você quiser testar, rode com: --include-avulso=true
        if (includeAvulso) {
            await step("OPCIONAL: Payment avulso (POST /payment) com type='pix' e washServices=array", async () => {
                assertNotNull(authToken, "Token não disponível para o pagamento avulso.");
                assertNotNull(createdUserCpf, "CPF do usuário não disponível para o pagamento avulso.");
                assert(selectedWashServices.ids.length > 0, "Sem washServices ids para testar pagamento avulso.");

                // Backend exige "value". Vamos calcular pelo DB (somando preços) e garantir > 0.
                const sum = (selectedWashServices.services || []).reduce((acc: number, s: any) => acc + Number(s.price || 0), 0);
                const value = sum > 0 ? sum : 1;

                const payload: Json = {
                    type: "pix",
                    cpf: createdUserCpf,
                    phone: generateValidPhone11Digits(),
                    washServices: selectedWashServices.ids,
                    value,
                };

                log("PAYMENT", "Request payment avulso", payload);

                const r = await httpRequest({
                    baseUrl,
                    path: "/payment",
                    method: "POST",
                    token: authToken,
                    body: payload,
                    timeoutMs,
                });

                log("PAYMENT", "Resposta payment avulso", {
                    url: r.url,
                    status: r.status,
                    body: unwrapCustomJson(r.data),
                });

                if (!r.ok) {
                    throw new Error(
                        `Payment avulso falhou. HTTP ${r.status}\nURL=${r.url}\nBody=${safeJsonStringify(r.data)}`
                    );
                }
            });
        } else {
            log("PAYMENT", "Step avulso pulado (includeAvulso=false).", {
                obs: "Fase 2 valida apenas subscribe; /payment exige value e não é escopo da fase.",
            });
        }

        log("DONE", "=== PASS: Payments Phase 2 OK ===", {
            createdUserId,
            createdUserEmail,
            createdCarId,
            includeAvulso,
        });
    } finally {
        if (cleanup) {
            log("CLEANUP", "Iniciando cleanup best-effort...", {
                createdUserId: createdUserId ?? null,
                createdCarId: createdCarId ?? null,
            });

            try {
                if (createdUserId) {
                    await cleanupPaymentsAndSubscriptionsBestEffort(prisma, createdUserId);
                }
            } catch (e: any) {
                warn("CLEANUP", "Falha no cleanup de payments/subscriptions (best-effort).", { message: e?.message });
            }

            try {
                if (createdCarId) {
                    await deleteCarByDbBestEffort(prisma, createdCarId);
                }
            } catch (e: any) {
                warn("CLEANUP", "Falha no cleanup do carro (best-effort).", { message: e?.message });
            }

            try {
                if (createdUserId) {
                    await deleteUserBestEffort(prisma, createdUserId);
                }
            } catch (e: any) {
                err("CLEANUP", "Cleanup do usuário falhou (atenção: pode ter sobrado resíduo).", { message: e?.message });
            }

            try {
                if (createdUserId) {
                    const stillUser = await prisma.user.findUnique({
                        where: { id: createdUserId },
                        select: { id: true, deletedAt: true },
                    });
                    log("CLEANUP", "Verificação pós-cleanup", {
                        userExists: Boolean(stillUser),
                        userDeletedAt: stillUser?.deletedAt ?? null,
                    });
                }
            } catch (e: any) {
                warn("CLEANUP", "Falha ao verificar pós-cleanup (best-effort).", { message: e?.message });
            }

            log("CLEANUP", "Cleanup finalizado.");
        } else {
            log("CLEANUP", "cleanup=false => pulando cleanup.");
        }

        await prisma.$disconnect();
        log("FINALLY", "Prisma desconectado.");
    }
}

main().catch((e: any) => {
    err("FAIL", "=== FAIL: Payments Phase 2 ===", { message: e?.message, stack: e?.stack });
    process.exitCode = 1;
});
