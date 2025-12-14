/* scripts/smoke-e2e.js */
require("dotenv").config({ path: process.env.DOTENV_PATH || "scripts/.env.smoke" });

const crypto = require("crypto");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3002").replace(/\/$/, "");
const ALLOW_NON_LOCAL = (process.env.ALLOW_NON_LOCAL || "false").toLowerCase() === "true";

const AUTH_LOGIN_PATH = (process.env.AUTH_LOGIN_PATH || "").trim();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;

let USER_CPF = (process.env.USER_CPF || "").trim();

const ADMIN_TOKEN_ENV = (process.env.ADMIN_TOKEN || "").trim();
const USER_TOKEN_ENV = (process.env.USER_TOKEN || "").trim();

const RUN_ASAAS_TESTS = (process.env.RUN_ASAAS_TESTS || "false").toLowerCase() === "true";
const RUN_AVULSO_TESTS = (process.env.RUN_AVULSO_TESTS || "false").toLowerCase() === "true";
const RUN_WEBHOOK_TESTS = (process.env.RUN_WEBHOOK_TESTS || "false").toLowerCase() === "true";

const ASAAS_ACCESS_TOKEN = process.env.ASAAS_ACCESS_TOKEN || "";

const WASH_SERVICE_IDS = (process.env.WASH_SERVICE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);

const CLEANUP = (process.env.CLEANUP || "false").toLowerCase() === "true";

let fetchFn = global.fetch;
if (!fetchFn) {
    fetchFn = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function isLocalUrl(url) {
    return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("0.0.0.0");
}

function nowIsoShort() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function safeJsonStringify(v) {
    try {
        return JSON.stringify(v, null, 2);
    } catch {
        return String(v);
    }
}

/**
 * Tenta entender customJson:
 * - se tiver "data", prioriza payload.data
 * - senão retorna payload inteiro
 */
function unwrapCustomJson(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return payload.data;
    return payload;
}

function extractToken(payloadRaw) {
    const payload = unwrapCustomJson(payloadRaw);
    if (!payload || typeof payload !== "object") return null;

    return (
        payload.token ||
        payload.accessToken ||
        payload.access_token ||
        payload.jwt ||
        payload?.data?.token ||
        null
    );
}

async function http(path, { method = "GET", token, body, headers } = {}) {
    const url = `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

    const init = {
        method,
        headers: {
            ...(headers || {}),
        },
    };

    if (token) init.headers.Authorization = `Bearer ${token}`;

    if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }

    const res = await fetchFn(url, init);

    const contentType = res.headers.get("content-type") || "";
    let data = null;

    if (contentType.includes("application/json")) {
        data = await res.json().catch(() => null);
    } else {
        data = await res.text().catch(() => null);
    }

    return { ok: res.ok, status: res.status, data, url };
}

async function step(name, fn) {
    process.stdout.write(`\n[STEP] ${name}\n`);
    try {
        const out = await fn();
        process.stdout.write(`[OK]   ${name}\n`);
        return out;
    } catch (e) {
        process.stdout.write(`[FAIL] ${name}\n`);
        throw e;
    }
}

/**
 * Descobre o endpoint de login real.
 */
async function resolveLoginPath() {
    if (AUTH_LOGIN_PATH) return AUTH_LOGIN_PATH;

    const candidates = [
        "/auth/login",
        "/auth/signin",
        "/auth/sign-in",
        "/auth/session",
        "/auth/authenticate",
    ];

    for (const p of candidates) {
        const probe = await http(p, {
            method: "POST",
            body: { email: "probe@x.com", password: "x" },
        });
        if (probe.status !== 404) return p;
    }

    throw new Error(`Não consegui descobrir o endpoint de login. Defina AUTH_LOGIN_PATH no .env.smoke.`);
}

async function login(email, password) {
    assert(email && password, "Email/senha não configurados no .env.smoke");
    const loginPath = await resolveLoginPath();

    const r = await http(loginPath, { method: "POST", body: { email, password } });

    if (!r.ok) {
        throw new Error(
            `Falha no login (${email}). Path=${loginPath} Status=${r.status}\nBody=${safeJsonStringify(r.data)}`
        );
    }

    const token = extractToken(r.data);
    if (!token) {
        throw new Error(`Login OK, mas não encontrei token no retorno.\nBody=${safeJsonStringify(r.data)}`);
    }

    return token;
}

/**
 * Se USER_CPF não vier no env, tenta buscar do banco via Prisma.
 * (Assume que você roda o script no mesmo repo, com @prisma/client instalado e DATABASE_URL válido.)
 */
async function ensureUserCpfFromDbIfMissing(email) {
    if (USER_CPF) return USER_CPF;

    try {
        const { PrismaClient } = require("@prisma/client");
        const prisma = new PrismaClient();

        const user = await prisma.user.findUnique({ where: { email } });
        await prisma.$disconnect();

        if (!user) throw new Error(`Usuário não encontrado no banco para email=${email}`);

        const cpf = user.cpf || user.cpfCnpj;
        if (!cpf) throw new Error(`Usuário encontrado, mas sem cpf/cpfCnpj no banco. email=${email}`);

        USER_CPF = String(cpf);
        console.log(`[INFO] USER_CPF resolvido via banco: ${USER_CPF}`);
        return USER_CPF;
    } catch (e) {
        console.log(
            `[WARN] Não consegui resolver USER_CPF via Prisma. Sete USER_CPF no .env.smoke.\nMotivo: ${e?.message || e}`
        );
        return "";
    }
}

function normalizePlate(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function randInt(maxExclusive) {
    return crypto.randomInt(0, maxExclusive);
}

function randLetters(n) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let out = "";
    for (let i = 0; i < n; i++) out += letters[randInt(letters.length)];
    return out;
}

function randDigits(n) {
    const digits = "0123456789";
    let out = "";
    for (let i = 0; i < n; i++) out += digits[randInt(digits.length)];
    return out;
}

/**
 * Gera placas válidas conforme seu Zod:
 * - AAA9999
 * - AAA9A99 (Mercosul)
 */
function generateValidPlate(preferMercosul = true) {
    if (preferMercosul) {
        // AAA9A99
        return `${randLetters(3)}${randDigits(1)}${randLetters(1)}${randDigits(2)}`;
    }
    // AAA9999
    return `${randLetters(3)}${randDigits(4)}`;
}

async function listMyCars(userToken) {
    const r = await http("/user-car", { method: "GET", token: userToken });
    if (!r.ok) return [];
    const list = unwrapCustomJson(r.data);
    return Array.isArray(list) ? list : [];
}

async function findMyCarByPlate(userToken, plate) {
    const wanted = normalizePlate(plate);
    const cars = await listMyCars(userToken);
    return cars.find((c) => normalizePlate(c?.licensePlate) === wanted) || null;
}

function isAlreadyRegisteredMessage(payload) {
    const raw = payload && typeof payload === "object" ? payload : null;
    const message =
        raw?.message ||
        raw?.error ||
        raw?.data?.message ||
        raw?.data?.error ||
        "";
    return String(message).toLowerCase().includes("já está registrado");
}

/**
 * Registra carro com tentativas:
 * - gera placa válida e bem aleatória
 * - se der "já está registrado", tenta outra placa
 * - se der erro mas o carro existir na listagem, prossegue (cobre retry/bug)
 */
async function registerCarWithRetries(userToken, runId, maxAttempts = 8) {
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const preferMercosul = attempt <= 3; // tenta Mercosul primeiro
        const plate = generateValidPlate(preferMercosul);

        const body = {
            licensePlate: plate,
            color: "Preto",
            model: "Civic",
            brand: "Honda",
            year: 2022,
        };

        const r = await http("/user-car", { method: "POST", token: userToken, body });

        if (r.ok) {
            const car = unwrapCustomJson(r.data);
            assert(car?.id, "Carro criado sem id no retorno");
            console.log("Carro criado:", { id: car.id, licensePlate: car.licensePlate, attempt, runId });
            return car;
        }

        // Se falhou, tenta descobrir se mesmo assim apareceu cadastrado (retry/bug)
        const existing = await findMyCarByPlate(userToken, plate);
        if (existing && existing?.id) {
            console.log(
                `[WARN] POST /user-car falhou, mas placa apareceu na listagem. Prosseguindo com o registro existente:`,
                { id: existing.id, licensePlate: existing.licensePlate, attempt, status: r.status }
            );
            return existing;
        }

        // Se for colisão de placa, tenta de novo com outra
        if ([400, 409].includes(r.status) && isAlreadyRegisteredMessage(r.data)) {
            console.log(
                `[INFO] Placa colidiu (já registrada). Tentando outra...`,
                { plate: normalizePlate(plate), attempt, status: r.status }
            );
            lastErr = r;
            continue;
        }

        // Erros de validação (400/422) também podem acontecer; tenta outra placa
        if ([400, 422].includes(r.status)) {
            console.log(
                `[INFO] Erro de validação ao registrar carro. Tentando outra placa...`,
                { attempt, status: r.status, body: unwrapCustomJson(r.data) }
            );
            lastErr = r;
            continue;
        }

        lastErr = r;
        break;
    }

    throw new Error(
        `Falha ao registrar carro em /user-car após tentativas.\n` +
        `Último status=${lastErr?.status}\nBody=${safeJsonStringify(lastErr?.data)}`
    );
}

async function createPlanWithFallback(adminToken, runId) {
    const base = {
        name: `E2E Plano Pacote Mensal ${runId}`,
        description: "Plano criado pelo smoke test",
        price: 10,
        duration: 30,
        isBestChoice: false,
        extraMonths: 0,
        isPackage: true,
        periodicityType: "MONTH",
    };

    const candidates = [
        { ...base, washServices: WASH_SERVICE_IDS.length ? WASH_SERVICE_IDS : [] },
        { ...base, washServiceIds: WASH_SERVICE_IDS.length ? WASH_SERVICE_IDS : [] },
        { ...base },
    ];

    let lastError = null;

    for (const body of candidates) {
        const r = await http("/plans", { method: "POST", token: adminToken, body });
        if (r.ok) {
            const plan = unwrapCustomJson(r.data);
            assert(plan?.id, "Plano criado sem id no retorno");
            return plan;
        }
        lastError = r;
        if (![400, 422].includes(r.status)) break;
    }

    throw new Error(
        `Erro ao criar plano em /plans. Última resposta:\nStatus=${lastError?.status}\nBody=${safeJsonStringify(lastError?.data)}`
    );
}

async function updatePlanWithFallback(adminToken, plan) {
    const candidates = [
        { name: `${plan.name} (updated)` },
        {
            name: `${plan.name} (updated)`,
            description: plan.description || "Atualizado pelo smoke test",
            price: Number(plan.price ?? 10),
            duration: Number(plan.duration ?? 30),
            isBestChoice: Boolean(plan.isBestChoice ?? false),
            extraMonths: Number(plan.extraMonths ?? 0),
            isPackage: Boolean(plan.isPackage ?? true),
            periodicityType: plan.periodicityType || "MONTH",
            washServices: [],
        },
    ];

    let last = null;

    for (const body of candidates) {
        const r = await http(`/plans/${plan.id}`, { method: "PUT", token: adminToken, body });
        last = r;
        if (r.ok) return unwrapCustomJson(r.data);
        if (![400, 422].includes(r.status)) break;
    }

    throw new Error(
        `Falha ao atualizar /plans/:id.\nStatus=${last?.status}\nBody=${safeJsonStringify(last?.data)}`
    );
}

(async function main() {
    if (!ALLOW_NON_LOCAL && !isLocalUrl(BASE_URL)) {
        throw new Error(
            `BASE_URL (${BASE_URL}) não é local. Para permitir, defina ALLOW_NON_LOCAL=true (cuidado com cobranças reais ASAAS).`
        );
    }

    const runId = nowIsoShort();
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Run ID: ${runId}`);

    // 1) Tokens
    const adminToken = ADMIN_TOKEN_ENV || (await step("Login ADMIN", () => login(ADMIN_EMAIL, ADMIN_PASSWORD)));
    const userToken = USER_TOKEN_ENV || (await step("Login USER", () => login(USER_EMAIL, USER_PASSWORD)));

    // 2) Sanity: planos públicos
    await step("Planos: listar (público, sem auth)", async () => {
        const r = await http("/plans", { method: "GET" });
        assert(r.ok, `Falha ao listar /plans. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);
        const list = unwrapCustomJson(r.data);
        assert(Array.isArray(list), "GET /plans não retornou array");
        console.log(`Total planos públicos: ${list.length}`);
    });

    // 3) Planos: criar/buscar/atualizar (ADMIN)
    const createdPlan = await step("Planos: criar (ADMIN)", async () => {
        const plan = await createPlanWithFallback(adminToken, runId);
        console.log("Plano criado:", { id: plan.id, name: plan.name, isPackage: plan.isPackage });
        return plan;
    });

    await step("Planos: buscar por ID", async () => {
        const r = await http(`/plans/${createdPlan.id}`, { method: "GET" });
        assert(r.ok, `Falha GET /plans/:id. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);
        const plan = unwrapCustomJson(r.data);
        assert(plan?.id === createdPlan.id, "GET /plans/:id retornou plano incorreto");
    });

    await step("Planos: atualizar (ADMIN)", async () => {
        const updated = await updatePlanWithFallback(adminToken, createdPlan);
        console.log("Plano atualizado:", { id: updated.id, name: updated.name });
    });

    // 4) Carros: criar/listar/update (USER)
    const createdCar = await step("User-Car: registrar carro (USER)", async () => {
        return await registerCarWithRetries(userToken, runId, 8);
    });

    await step("User-Car: listar carros do usuário autenticado", async () => {
        const cars = await listMyCars(userToken);
        console.log(`Total carros (auth user): ${cars.length}`);
        assert(Array.isArray(cars), "GET /user-car não retornou array");
    });

    await step("User-Car: atualizar carro (USER) via PUT /user-car/:id", async () => {
        // seu middleware injectParamIdIntoBody garante id no body.
        // aqui mandamos payload completo por segurança (caso você endureça o DTO no futuro)
        const body = {
            licensePlate: createdCar.licensePlate,
            color: "Cinza",
            model: createdCar.model || "Civic",
            brand: createdCar.brand || "Honda",
            year: createdCar.year || 2022,
        };

        const r = await http(`/user-car/${createdCar.id}`, { method: "PUT", token: userToken, body });
        assert(r.ok, `Falha PUT /user-car/:id. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);

        const car = unwrapCustomJson(r.data);
        assert(car?.id === createdCar.id, "Update retornou carro com ID inesperado");
    });

    // 5) Assinatura via pagamento (opcional)
    if (RUN_ASAAS_TESTS) {
        await ensureUserCpfFromDbIfMissing(USER_EMAIL);
        assert(USER_CPF, "USER_CPF está vazio. Sete no .env.smoke ou garanta cpf no banco.");

        await step("Payment: subscribe (USER) => POST /payment/subscribe", async () => {
            const body = {
                plan_id: createdPlan.id,
                carId: createdCar.id,
                type: "pix",
                cpf: USER_CPF,
                timeZoneOffset: -180,
            };

            const r = await http("/payment/subscribe", { method: "POST", token: userToken, body });
            assert(r.ok, `Falha POST /payment/subscribe. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);

            const out = unwrapCustomJson(r.data);
            const subscription = out?.subscription || out?.data?.subscription || out;
            assert(subscription?.id, "Subscribe não retornou subscription.id");

            console.log("Subscription criada:", {
                id: subscription.id,
                isActive: subscription.isActive,
                status: subscription.subscriptionStatus,
                expiresAt: subscription.expiresAt,
            });
        });

        await step("Subscription: listar (USER) => GET /subscription", async () => {
            const r = await http("/subscription", { method: "GET", token: userToken });
            assert(r.ok, `Falha GET /subscription. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);
            const list = unwrapCustomJson(r.data);
            assert(Array.isArray(list), "GET /subscription não retornou array");
            console.log(`Total subscriptions do usuário: ${list.length}`);
        });
    } else {
        console.log("\n[INFO] RUN_ASAAS_TESTS=false => pulando /payment/subscribe e /subscription.");
    }

    // 6) Pagamento avulso (opcional)
    if (RUN_AVULSO_TESTS) {
        await ensureUserCpfFromDbIfMissing(USER_EMAIL);
        assert(USER_CPF, "USER_CPF está vazio. Sete no .env.smoke ou garanta cpf no banco.");
        assert(WASH_SERVICE_IDS.length > 0, "Defina WASH_SERVICE_IDS no .env.smoke para RUN_AVULSO_TESTS=true.");

        await step("Payment avulso: POST /payment", async () => {
            const body = { type: "pix", cpf: USER_CPF, washServices: WASH_SERVICE_IDS };

            const r = await http("/payment", { method: "POST", token: userToken, body });
            assert(r.ok, `Falha POST /payment. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);

            const out = unwrapCustomJson(r.data);
            console.log("Pagamento avulso criado (resumo):", {
                hasPayment: !!out?.payment,
                amount: out?.amount,
            });
        });
    } else {
        console.log("\n[INFO] RUN_AVULSO_TESTS=false => pulando POST /payment (avulso).");
    }

    // 7) Webhook manual (opcional)
    if (RUN_WEBHOOK_TESTS) {
        assert(ASAAS_ACCESS_TOKEN, "Para RUN_WEBHOOK_TESTS=true você precisa setar ASAAS_ACCESS_TOKEN no .env.smoke.");

        await step("Webhook manual: POST /payment/payments-webhook", async () => {
            const r = await http("/payment/payments-webhook", {
                method: "POST",
                headers: {
                    "asaas-access-token": ASAAS_ACCESS_TOKEN,
                    "Content-Type": "application/json",
                },
                body: {}, // sem event => fluxo deve responder 200
            });

            assert(r.ok, `Falha webhook. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);
            console.log("Webhook respondeu:", unwrapCustomJson(r.data));
        });
    } else {
        console.log("\n[INFO] RUN_WEBHOOK_TESTS=false => pulando /payment/payments-webhook.");
    }

    // 8) Checagem rápida: métricas /users/count/* (pode estar quebrado por ordem de rotas)
    await step("Users: probe /users/count/all (pode falhar por conflito com /:id)", async () => {
        const r = await http("/users/count/all", { method: "GET", token: adminToken });
        if (r.ok) {
            console.log("OK /users/count/all:", unwrapCustomJson(r.data));
            return;
        }

        console.log(
            `[WARN] /users/count/all não respondeu 200. Status=${r.status}\nBody=${safeJsonStringify(r.data)}\n` +
            `Se o erro for "ID inválido", reordene as rotas de /users: coloque "/count/*" ANTES de "/:id".`
        );
    });

    // 9) Cleanup (opcional)
    if (CLEANUP) {
        await step("Cleanup: deletar carro (pode falhar se tiver plano ativo)", async () => {
            const r = await http(`/user-car/${createdCar.id}`, { method: "DELETE", token: userToken });
            if (r.status === 204 || r.ok) {
                console.log("Carro deletado.");
                return;
            }
            console.log("Falha ao deletar carro (regra/plano ativo?):", r.status, unwrapCustomJson(r.data));
        });

        await step("Cleanup: deletar plano", async () => {
            const r = await http(`/plans/${createdPlan.id}`, { method: "DELETE", token: adminToken });
            if (r.status === 204 || r.ok) {
                console.log("Plano deletado.");
                return;
            }
            console.log("Falha ao deletar plano (pode estar referenciado):", r.status, unwrapCustomJson(r.data));
        });
    }

    console.log("\n✅ Smoke test finalizado com sucesso.");
})().catch((err) => {
    console.error("\n❌ Smoke test falhou:");
    console.error(err?.message || err);
    process.exit(1);
});
