/* eslint-disable no-console */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;

function nowIso(): string {
    return new Date().toISOString();
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

async function httpRequest(baseUrl: string, path: string, method: "GET" | "POST", body: Json | null, timeoutMs: number) {
    const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
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
    log("PING", "Pingando API para validar conectividade...", { baseUrl, pingPath, timeoutMs });

    const r = await httpRequest(baseUrl, pingPath, "GET", null, timeoutMs);

    log("PING", "Ping OK (conectou).", {
        url: r.url,
        status: r.status,
        obs: "Status pode ser 200/401/404; o importante é conectar.",
    });
}

async function dbHealthCheck(prisma: PrismaClient) {
    log("DB", "Rodando healthcheck do banco (SELECT 1)...");

    try {
        const r = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 as ok`);
        log("DB", "DB healthcheck OK.", { result: r?.[0] ?? null });
    } catch (e: any) {
        err("DB", "DB healthcheck FAIL: não foi possível conectar no banco.", {
            message: e?.message,
        });
        throw e;
    }
}

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Gera CPF válido (11 dígitos).
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
        const exists = await prisma.user.findUnique({ where: { cpf } });
        if (!exists) return cpf;
    }
    throw new Error("Não consegui gerar CPF único após 50 tentativas.");
}

function generateUniqueEmail(): string {
    const ts = Date.now();
    const r = Math.random().toString(16).slice(2);
    return `smoke.referrals.${ts}.${r}@example.com`.toLowerCase();
}

async function bestEffortCleanup(prisma: PrismaClient, createdUserId: number) {
    log("CLEANUP", `Iniciando cleanup para userId=${createdUserId}`);

    // UserReferral (auditoria) - tentativa via SQL raw
    try {
        const deletedAudit = await prisma.$executeRawUnsafe(
            `DELETE FROM "UserReferral" WHERE "referredId" = $1`,
            createdUserId,
        );
        log("CLEANUP", "UserReferral DELETE OK (raw)", { deletedAudit });
    } catch (e: any) {
        warn("CLEANUP", 'Falha ao deletar "UserReferral" (raw).', { message: e?.message });
    }

    // ReferralBonus - tentativa via SQL raw
    try {
        const deletedBonus = await prisma.$executeRawUnsafe(
            `DELETE FROM "ReferralBonus" WHERE "payerId" = $1 OR "receiverId" = $1`,
            createdUserId,
        );
        log("CLEANUP", "ReferralBonus DELETE OK (raw)", { deletedBonus });
    } catch (e: any) {
        warn("CLEANUP", 'Falha ao deletar "ReferralBonus" (raw).', { message: e?.message });
    }

    // Tenta apagar o User (hard delete) e, se falhar, faz soft delete
    try {
        await prisma.user.delete({ where: { id: createdUserId } });
        log("CLEANUP", "User.delete OK");
    } catch (e: any) {
        warn("CLEANUP", "User.delete falhou; tentando soft-delete.", { message: e?.message });
        try {
            await prisma.user.update({
                where: { id: createdUserId },
                data: { deletedAt: new Date() },
            });
            log("CLEANUP", "User soft-delete OK (deletedAt setado)");
        } catch (e2: any) {
            err("CLEANUP", "Falha também no soft-delete do usuário.", { message: e2?.message });
            throw e2;
        }
    }

    // Verificação final (best effort)
    try {
        const stillUser = await prisma.user.findUnique({
            where: { id: createdUserId },
            select: { id: true, deletedAt: true },
        });

        let auditExists = false;
        try {
            const audit = await prisma.$queryRawUnsafe<any[]>(
                `SELECT "id" FROM "UserReferral" WHERE "referredId" = $1 LIMIT 1`,
                createdUserId,
            );
            auditExists = Boolean(audit?.length);
        } catch {
            // ignore
        }

        log("CLEANUP", "Verificação pós-cleanup", {
            userExists: Boolean(stillUser),
            userDeletedAt: stillUser?.deletedAt ?? null,
            userReferralExists: auditExists,
        });
    } catch (e: any) {
        warn("CLEANUP", "Falha ao verificar pós-cleanup (best-effort).", { message: e?.message });
    }

    log("CLEANUP", "Cleanup finalizado.");
}

async function main() {
    const args = parseArgs(process.argv);

    const baseUrl = (args["base-url"] as string) || process.env.SMOKE_BASE_URL || "http://localhost:3000";
    const pingPath = (args["ping-path"] as string) || "/";
    const validatePath = (args["validate-path"] as string) || "/referrals/validate";
    const registerPath = (args["register-path"] as string) || "/auth/register";
    const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 15000;

    const referrerCodeArg = (args["referrer-code"] as string) || process.env.SMOKE_REFERRER_CODE || "";
    const referrerIdArg = args["referrer-id"] ? Number(args["referrer-id"]) : null;

    const dbUrl = (args["db-url"] as string) || process.env.DATABASE_URL || "";
    if (!dbUrl) {
        throw new Error("DATABASE_URL não informado. Configure no .env ou passe --db-url=...");
    }

    log("INIT", "=== Smoke Test: Referrals Phase 1 (com cleanup) ===");
    log("INIT", "Config", {
        baseUrl,
        pingPath,
        validatePath,
        registerPath,
        timeoutMs,
        referrerIdArg,
        referrerCodeArg: referrerCodeArg ? "***provided***" : null,
    });
    log("INIT", "DATABASE_URL (sanitizado)", sanitizeDbUrl(dbUrl));

    // Prisma client isolado para o script (permite override de dbUrl)
    const prisma = new PrismaClient({
        datasources: {
            db: { url: dbUrl },
        },
    });

    let createdUserId: number | null = null;

    try {
        // 0) Ping API
        await pingBaseUrl(baseUrl, pingPath, Math.min(timeoutMs, 8000));

        // 0.1) DB healthcheck (garante cleanup possível)
        await dbHealthCheck(prisma);

        // 1) Selecionar referrer
        log("STEP1", "Selecionando referrer...");

        let referrerCode = referrerCodeArg.trim();

        if (!referrerCode) {
            const referrer = referrerIdArg
                ? await prisma.user.findFirst({
                    where: { id: referrerIdArg, deletedAt: null, status: "ACTIVE" },
                    select: { id: true, name: true, email: true, status: true, referralCode: true },
                })
                : await prisma.user.findFirst({
                    where: { deletedAt: null, status: "ACTIVE", referralCode: { not: null } },
                    select: { id: true, name: true, email: true, status: true, referralCode: true },
                    orderBy: { id: "asc" },
                });

            if (!referrer || !referrer.referralCode) {
                throw new Error("Não encontrei um usuário ACTIVE com referralCode para usar como referrer.");
            }

            referrerCode = String(referrer.referralCode).trim();

            log("STEP1", "Referrer selecionado via DB", {
                id: referrer.id,
                name: referrer.name,
                email: referrer.email,
                status: referrer.status,
                referralCode: referrerCode,
            });
        } else {
            log("STEP1", "ReferrerCode fornecido via argumento/env", { referralCode: referrerCode });
        }

        if (!referrerCode) {
            throw new Error("referrerCode vazio após seleção.");
        }

        // 2) Validate endpoint
        log("STEP2", "Chamando validate endpoint...", { body: { referralCode: referrerCode } });

        const validateResp = await httpRequest(
            baseUrl,
            validatePath,
            "POST",
            { referralCode: referrerCode },
            timeoutMs,
        );

        log("STEP2", "Resposta validate", {
            url: validateResp.url,
            status: validateResp.status,
            data: validateResp.data,
        });

        if (validateResp.status !== 200) {
            throw new Error(`Validate falhou. HTTP ${validateResp.status}`);
        }

        const isValid = Boolean((validateResp.data as any)?.isValid);
        if (!isValid) {
            throw new Error("API respondeu isValid=false para um referralCode fornecido.");
        }
        log("STEP2", "OK: isValid=true");

        // 3) Register com referrerCode
        log("STEP3", "Criando usuário via /auth/register (com referrerCode)...");

        const cpf = await generateUniqueCpf(prisma);
        const email = generateUniqueEmail();

        const registerBody: Json = {
            name: "Smoke Referral Phase1",
            email,
            password: "123456",
            phone: "11999999999",
            cpf,
            referrerCode: referrerCode,
        };

        log("STEP3", "Request register", { ...registerBody, password: "***" });

        const registerResp = await httpRequest(baseUrl, registerPath, "POST", registerBody, timeoutMs);

        log("STEP3", "Resposta register", {
            url: registerResp.url,
            status: registerResp.status,
            jsonKeys: typeof registerResp.data === "object" && registerResp.data ? Object.keys(registerResp.data) : null,
            user: (registerResp.data as any)?.user
                ? {
                    id: (registerResp.data as any).user.id,
                    email: (registerResp.data as any).user.email,
                    referrerId: (registerResp.data as any).user.referrerId,
                }
                : null,
        });

        if (registerResp.status !== 201) {
            throw new Error(`Register falhou. HTTP ${registerResp.status}`);
        }

        const newUserId = Number((registerResp.data as any)?.user?.id);
        if (!newUserId || Number.isNaN(newUserId)) {
            throw new Error("Register não retornou user.id válido.");
        }

        createdUserId = newUserId;
        log("STEP3", "OK: usuário criado", { id: createdUserId, email, cpf });

        // 4) Validar no DB os efeitos da Fase 1
        log("STEP4", "Validando efeitos no DB (referrerId + UserReferral)...");

        const created = await prisma.user.findUnique({
            where: { id: createdUserId },
            select: { id: true, referrerId: true, referralCode: true, status: true, createdAt: true, deletedAt: true },
        });

        if (!created) {
            throw new Error("Usuário recém criado não encontrado no DB.");
        }

        log("STEP4", "DB User encontrado", created);

        if (!created.referrerId || created.referrerId <= 0) {
            throw new Error("Fase 1 FAIL: user.referrerId não foi preenchido.");
        }

        const audit = await prisma.$queryRawUnsafe<any[]>(
            `SELECT "id", "referrerId", "referredId", "source", "createdAt"
			 FROM "UserReferral"
			 WHERE "referredId" = $1
			 LIMIT 1`,
            createdUserId,
        );

        log("STEP4", "DB UserReferral (raw)", audit?.[0] ?? null);

        if (!audit || audit.length === 0) {
            throw new Error('Fase 1 FAIL: não existe registro em "UserReferral" para o usuário recém criado.');
        }

        log("DONE", "=== PASS: Referrals Phase 1 OK ===", {
            referredId: createdUserId,
            referrerId: created.referrerId,
            referredReferralCode: created.referralCode,
            audit: audit[0],
        });
    } finally {
        // Cleanup obrigatório
        if (createdUserId) {
            try {
                await bestEffortCleanup(prisma, createdUserId);
            } catch (e: any) {
                err("CLEANUP", "Cleanup falhou (atenção: pode ter sobrado resíduo).", { message: e?.message });
                throw e;
            }
        } else {
            log("CLEANUP", "Nenhum user criado; nada para reverter.");
        }

        await prisma.$disconnect();
        log("FINALLY", "Prisma desconectado.");
    }
}

main().catch((e: any) => {
    err("FAIL", "=== FAIL: Referrals Phase 1 ===", { message: e?.message, stack: e?.stack });
    process.exitCode = 1;
});
