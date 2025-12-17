/* scripts/smoke-admin-car.js */
require("dotenv").config({ path: process.env.DOTENV_PATH || "scripts/.env.smoke" });

const crypto = require("crypto");

// ==============================
// CONFIG (derivado do .env.smoke)
// ==============================
const CONFIG = {
    BASE_URL: (process.env.BASE_URL || "http://localhost:3002").replace(/\/$/, ""),
    ALLOW_NON_LOCAL: (process.env.ALLOW_NON_LOCAL || "false").toLowerCase() === "true",

    AUTH_LOGIN_PATH: (process.env.AUTH_LOGIN_PATH || "").trim(),

    ADMIN_EMAIL: (process.env.ADMIN_EMAIL || "").trim(),
    ADMIN_PASSWORD: (process.env.ADMIN_PASSWORD || "").trim(),

    USER_EMAIL: (process.env.USER_EMAIL || "").trim(),
    USER_PASSWORD: (process.env.USER_PASSWORD || "").trim(),

    // Opcional: se quiser pular login e usar token pronto
    ADMIN_TOKEN_ENV: (process.env.ADMIN_TOKEN || "").trim(),
    USER_TOKEN_ENV: (process.env.USER_TOKEN || "").trim(),

    // Transfer test: se tiver um userId pronto para transferir, use isso
    DEST_USER_ID: Number(process.env.DEST_USER_ID || "0") || 0,

    // Se quiser que o script crie um usuário via Prisma para transferir:
    RUN_PRISMA_CREATE_DEST_USER: (process.env.RUN_PRISMA_CREATE_DEST_USER || "true").toLowerCase() === "true",

    // Cleanup sempre ON por padrão (pode desligar se quiser muito)
    CLEANUP: (process.env.CLEANUP || "true").toLowerCase() === "true",
};

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
    const url = `${CONFIG.BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

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
    if (CONFIG.AUTH_LOGIN_PATH) return CONFIG.AUTH_LOGIN_PATH;

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
 * Gera placas válidas:
 * - AAA9999
 * - AAA9A99 (Mercosul)
 */
function generateValidPlate(preferMercosul = true) {
    if (preferMercosul) return `${randLetters(3)}${randDigits(1)}${randLetters(1)}${randDigits(2)}`;
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
    const message = raw?.message || raw?.error || raw?.data?.message || raw?.data?.error || "";
    return String(message).toLowerCase().includes("já está registrado");
}

/**
 * Registra carro com tentativas:
 * - gera placa válida e bem aleatória
 * - se der "já está registrado", tenta outra placa
 * - se der erro mas o carro existir na listagem, prossegue
 */
async function registerCarWithRetries(userToken, runId, maxAttempts = 8) {
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const preferMercosul = attempt <= 3;
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

        const existing = await findMyCarByPlate(userToken, plate);
        if (existing && existing?.id) {
            console.log(
                `[WARN] POST /user-car falhou, mas placa apareceu na listagem. Prosseguindo com existente:`,
                { id: existing.id, licensePlate: existing.licensePlate, attempt, status: r.status }
            );
            return existing;
        }

        if ([400, 409].includes(r.status) && isAlreadyRegisteredMessage(r.data)) {
            console.log(`[INFO] Placa colidiu. Tentando outra...`, { plate: normalizePlate(plate), attempt, status: r.status });
            lastErr = r;
            continue;
        }

        if ([400, 422].includes(r.status)) {
            console.log(`[INFO] Erro de validação ao registrar. Tentando outra placa...`, {
                attempt,
                status: r.status,
                body: unwrapCustomJson(r.data),
            });
            lastErr = r;
            continue;
        }

        lastErr = r;
        break;
    }

    throw new Error(
        `Falha ao registrar carro em /user-car.\n` +
        `Último status=${lastErr?.status}\nBody=${safeJsonStringify(lastErr?.data)}`
    );
}

// ==============================
// Admin endpoints (com fallback)
// ==============================
async function resolveAdminGetCarByPlatePath(adminToken, plate) {
    const p = encodeURIComponent(normalizePlate(plate));

    const candidates = [
        `/users/cars/license-plate/${p}`,
        `/users/cars/licensePlate/${p}`,
        `/users/car/license-plate/${p}`,
        `/admin/cars/license-plate/${p}`,
        `/admin/user-car/license-plate/${p}`,
    ];

    for (const path of candidates) {
        const r = await http(path, { method: "GET", token: adminToken });
        if (r.status !== 404) return path;
    }

    throw new Error("Não consegui resolver endpoint admin de GET carro por placa. Ajuste as rotas/candidates.");
}

async function adminGetCarByPlate(adminToken, resolvedPath) {
    const r = await http(resolvedPath, { method: "GET", token: adminToken });
    assert(r.ok, `Falha GET admin car by plate. Status=${r.status}\nBody=${safeJsonStringify(r.data)}`);
    return unwrapCustomJson(r.data);
}

async function adminUpdateCarWithFallback(adminToken, carId, body) {
    const candidates = [
        { path: `/users/cars/${carId}`, method: "PATCH", body },
        { path: `/users/cars/${carId}`, method: "PUT", body },

        { path: `/admin/cars/${carId}`, method: "PATCH", body },
        { path: `/admin/cars/${carId}`, method: "PUT", body },

        { path: `/users/car/${carId}`, method: "PATCH", body },
        { path: `/users/car/${carId}`, method: "PUT", body },
    ];

    let last = null;

    for (const c of candidates) {
        const r = await http(c.path, { method: c.method, token: adminToken, body: c.body });
        last = r;
        if (r.ok) return unwrapCustomJson(r.data);
        if (r.status === 404) continue;
        // se não for 404, provavelmente achou endpoint mas falhou por validação/permissão
        break;
    }

    throw new Error(
        `Falha ao atualizar carro via admin (fallback).\nStatus=${last?.status}\nURL=${last?.url}\nBody=${safeJsonStringify(last?.data)}`
    );
}

// ==============================
// Prisma helper (opcional p/ criar DEST_USER)
// ==============================
async function prismaGetClient() {
    try {
        const { PrismaClient } = require("@prisma/client");
        return new PrismaClient();
    } catch (e) {
        throw new Error(`Precisa de @prisma/client para RUN_PRISMA_CREATE_DEST_USER=true.\nMotivo: ${e?.message || e}`);
    }
}

function randomCpf11() {
    return crypto.randomInt(10_000_000_000, 99_999_999_999).toString();
}

function randomEmail(prefix) {
    return `${prefix}.${Date.now()}.${crypto.randomInt(1000, 9999)}@test.com`;
}

async function prismaCreateDestUser() {
    const prisma = await prismaGetClient();
    try {
        // Ajuste campos se seu schema exigir algo diferente
        const user = await prisma.user.create({
            data: {
                name: "E2E Dest User",
                email: randomEmail("e2e.dest"),
                password: "123456",
                phone: "11999990000",
                cpf: randomCpf11(),
                role: "USER",
                status: "ACTIVE",
            },
            select: { id: true, email: true },
        });
        return user;
    } finally {
        await prisma.$disconnect().catch(() => void 0);
    }
}

async function prismaDeleteUserById(id) {
    const prisma = await prismaGetClient();
    try {
        await prisma.user.delete({ where: { id } }).catch((e) => {
            console.log("[WARN] Cleanup prisma: falha ao deletar usuário destino:", e?.message || e);
        });
    } finally {
        await prisma.$disconnect().catch(() => void 0);
    }
}

// ==============================
// MAIN
// ==============================
(async function main() {
    if (!CONFIG.ALLOW_NON_LOCAL && !isLocalUrl(CONFIG.BASE_URL)) {
        throw new Error(
            `BASE_URL (${CONFIG.BASE_URL}) não é local. Para permitir, defina ALLOW_NON_LOCAL=true.`
        );
    }

    const runId = nowIsoShort();
    console.log(`Base URL: ${CONFIG.BASE_URL}`);
    console.log(`Run ID: ${runId}`);

    let adminToken = null;
    let userToken = null;

    let createdCar = null;
    let adminGetByPlatePath = null;

    let originalUserId = null;

    let destUser = null; // { id, email } se criado via prisma

    try {
        adminToken = CONFIG.ADMIN_TOKEN_ENV || (await step("Login ADMIN", () => login(CONFIG.ADMIN_EMAIL, CONFIG.ADMIN_PASSWORD)));
        userToken = CONFIG.USER_TOKEN_ENV || (await step("Login USER", () => login(CONFIG.USER_EMAIL, CONFIG.USER_PASSWORD)));

        createdCar = await step("USER: registrar carro (POST /user-car)", async () => {
            const car = await registerCarWithRetries(userToken, runId, 8);
            assert(car?.id, "Carro criado sem id");
            originalUserId = car.userId;
            return car;
        });

        adminGetByPlatePath = await step("ADMIN: resolver endpoint GET carro por placa", async () => {
            return await resolveAdminGetCarByPlatePath(adminToken, createdCar.licensePlate);
        });

        await step("ADMIN: GET por placa (ativo)", async () => {
            const car = await adminGetCarByPlate(adminToken, adminGetByPlatePath);
            assert(Number(car?.id) === Number(createdCar.id), "Admin retornou carro com id diferente");
            console.log("Admin car (ativo):", { id: car.id, userId: car.userId, plate: car.licensePlate });
        });

        // ---------- Desativar ----------
        await step("ADMIN: desativar carro (PATCH isActive=false)", async () => {
            // suporte a DTOs diferentes (isActive vs active)
            const bodyCandidates = [
                { id: createdCar.id, isActive: false },
                { id: createdCar.id, active: false },
            ];

            let out = null;
            let lastErr = null;

            for (const b of bodyCandidates) {
                try {
                    out = await adminUpdateCarWithFallback(adminToken, createdCar.id, b);
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }

            if (!out) throw lastErr;

            // valida via listagem do usuário: deve sumir
            const cars = await listMyCars(userToken);
            const exists = cars.some((c) => Number(c?.id) === Number(createdCar.id));
            assert(!exists, "Após desativar, carro ainda aparece em GET /user-car");

            // valida via admin GET por placa: deve continuar aparecendo (includeInactive)
            const carAdmin = await adminGetCarByPlate(adminToken, adminGetByPlatePath);
            assert(Number(carAdmin?.id) === Number(createdCar.id), "Admin não encontrou carro desativado por placa");
            console.log("Admin car (desativado):", { id: carAdmin.id, userId: carAdmin.userId, plate: carAdmin.licensePlate });
        });

        // ---------- Ativar ----------
        await step("ADMIN: ativar carro (PATCH isActive=true)", async () => {
            const bodyCandidates = [
                { id: createdCar.id, isActive: true },
                { id: createdCar.id, active: true },
            ];

            let out = null;
            let lastErr = null;

            for (const b of bodyCandidates) {
                try {
                    out = await adminUpdateCarWithFallback(adminToken, createdCar.id, b);
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }

            if (!out) throw lastErr;

            const cars = await listMyCars(userToken);
            const exists = cars.some((c) => Number(c?.id) === Number(createdCar.id));
            assert(exists, "Após ativar, carro NÃO voltou a aparecer em GET /user-car");
        });

        // ---------- Transfer (userId) ----------
        await step("ADMIN: transferir carro (PATCH userId) [se possível]", async () => {
            let destUserId = CONFIG.DEST_USER_ID;

            // Se não veio do env, tenta criar via Prisma (opcional)
            if (!destUserId && CONFIG.RUN_PRISMA_CREATE_DEST_USER) {
                try {
                    destUser = await prismaCreateDestUser();
                    destUserId = destUser.id;
                    console.log("[INFO] Usuário destino criado via Prisma:", destUser);
                } catch (e) {
                    console.log("[WARN] Não consegui criar usuário destino via Prisma. Pulando transferência.", e?.message || e);
                    return;
                }
            }

            if (!destUserId) {
                console.log("[INFO] DEST_USER_ID não definido e Prisma desabilitado/indisponível. Pulando transferência.");
                return;
            }

            const updated = await adminUpdateCarWithFallback(adminToken, createdCar.id, { id: createdCar.id, userId: destUserId });
            assert(Number(updated?.userId) === Number(destUserId), "Transferência falhou: userId não mudou");

            // Confirma via admin GET por placa
            const carAdmin = await adminGetCarByPlate(adminToken, adminGetByPlatePath);
            assert(Number(carAdmin?.userId) === Number(destUserId), "Admin GET por placa não refletiu userId transferido");

            // Restaura para o usuário original
            const restored = await adminUpdateCarWithFallback(adminToken, createdCar.id, { id: createdCar.id, userId: originalUserId });
            assert(Number(restored?.userId) === Number(originalUserId), "Restore falhou: userId não voltou");

            console.log("[INFO] Transfer OK (ida e volta).");
        });

        console.log("\n✅ Smoke Admin-Car finalizado com sucesso.");
    } catch (err) {
        console.error("\n❌ Smoke Admin-Car falhou:");
        console.error(err?.message || err);
        process.exit(1);
    } finally {
        // CLEANUP best-effort (default ON)
        if (!CONFIG.CLEANUP) return;

        console.log("\n[INFO] Cleanup (best-effort) ...");

        try {
            // tenta garantir carro ativo + userId original antes de deletar
            if (adminToken && createdCar?.id && originalUserId) {
                try {
                    await adminUpdateCarWithFallback(adminToken, createdCar.id, { id: createdCar.id, userId: originalUserId, isActive: true });
                } catch {
                    // tenta outro body
                    await adminUpdateCarWithFallback(adminToken, createdCar.id, { id: createdCar.id, userId: originalUserId, active: true }).catch(() => void 0);
                }
            }

            // tenta deletar o carro como USER (pode falhar se tiver regra de plano ativo)
            if (userToken && createdCar?.id) {
                const r = await http(`/user-car/${createdCar.id}`, { method: "DELETE", token: userToken });
                if (r.ok || r.status === 204) console.log("[CLEANUP] Carro deletado.");
                else console.log("[WARN] Cleanup: falha ao deletar carro:", r.status, unwrapCustomJson(r.data));
            }

            // se criou usuário destino via Prisma, tenta remover
            if (destUser?.id) {
                await prismaDeleteUserById(destUser.id);
                console.log("[CLEANUP] Usuário destino removido (Prisma best-effort).");
            }
        } catch (e) {
            console.log("[WARN] Cleanup lançou erro:", e?.message || e);
        }
    }
})();
