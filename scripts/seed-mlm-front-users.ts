/* eslint-disable no-console */
import "dotenv/config";
import {
    PrismaClient,
    Role,
    UserStatus,
    WalletType,
    TransactionType,
    TransactionSource,
    BonusType,
    PaymentStatus,
    PaymentChannel,
    Prisma,
} from "@prisma/client";

import bcrypt from "bcryptjs";

// --------------------------------------------------
// CLI ARGS (PRECISA SER ANTES DO PrismaClient)
// --------------------------------------------------
type CliOptions = {
    appBaseUrl?: string;
    dbUrl?: string;
};

function readCliArg(name: string): string | null {
    const argv = process.argv.slice(2);

    // --name=value
    const eqPrefix = `--${name}=`;
    for (const a of argv) {
        if (a.startsWith(eqPrefix)) {
            return a.substring(eqPrefix.length).trim();
        }
    }

    // --name value
    const flag = `--${name}`;
    const idx = argv.findIndex((a) => a === flag);
    if (idx >= 0 && argv[idx + 1]) {
        return String(argv[idx + 1]).trim();
    }

    return null;
}

function parseCliOptions(): CliOptions {
    // aliases
    const baseUrl =
        readCliArg("base-url") ??
        readCliArg("app-base-url") ??
        readCliArg("appBaseUrl") ??
        readCliArg("baseUrl") ??
        undefined;

    const dbUrl =
        readCliArg("db-url") ??
        readCliArg("dbUrl") ??
        readCliArg("database-url") ??
        readCliArg("databaseUrl") ??
        undefined;

    return {
        appBaseUrl: baseUrl,
        dbUrl,
    };
}

function maskDbUrl(url: string): string {
    try {
        const u = new URL(url);
        const user = u.username ? u.username : "";
        const hasPass = u.password && u.password.length > 0;
        const auth = user ? `${user}:${hasPass ? "***" : ""}` : "";
        const host = u.host;
        const path = u.pathname;
        return `${u.protocol}//${auth ? auth + "@" : ""}${host}${path}`;
    } catch {
        return "***";
    }
}

const cli = parseCliOptions();

// aplica DATABASE_URL via argumento (PRECISA ser antes do PrismaClient)
if (cli.dbUrl && cli.dbUrl.trim().length > 0) {
    process.env.DATABASE_URL = cli.dbUrl.trim();
}

// aplica APP_BASE_URL via argumento
if (cli.appBaseUrl && cli.appBaseUrl.trim().length > 0) {
    process.env.APP_BASE_URL = cli.appBaseUrl.trim();
}

const prisma = new PrismaClient();

// --------------------------------------------------
// CONFIG FIXA (DADOS PARA FRONT)
// --------------------------------------------------
const TEST_PREFIX = "FRONT_MLM_TEST";
const TEST_EMAIL_DOMAIN = "mlm-test.local";

// ✅ OBRIGATÓRIO: Usuário 1
const USER1_EMAIL = "isaaczoom987@gmail.com";

// ✅ Senha já definida (NÃO ALTERAR se usuário já existir)
const USER1_PASSWORD_PLAIN = "150221Ie";

// Outros usuários de teste (posições 2..9)
const TEST_PASSWORD_PLAIN = "123456";

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

// ✅ GARANTIA: saldo mínimo visível do User 1 (sem uso)
const USER1_MIN_VISIBLE_BALANCE = 35;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function log(step: string, msg: string, data?: any) {
    console.log(`\n[${step}] ${msg}`);
    if (data) console.dir(data, { depth: null });
}

function competenceYearMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

function makeTestUserEmail(position: number): string {
    if (position === 1) return USER1_EMAIL;
    return `${TEST_PREFIX.toLowerCase()}.user${position}@${TEST_EMAIL_DOMAIN}`;
}

function makeTestUserName(position: number): string {
    if (position === 1) return `Isaac Zoom (User 1)`;
    return `${TEST_PREFIX} User ${position}`;
}

function makeTestReferralCode(position: number): string {
    return `${TEST_PREFIX}_CODE_${position}`;
}

function makeTestCpfFallback(position: number): string {
    return `9900000000${position}`;
}

function hashPassword(plain: string): string {
    return bcrypt.hashSync(plain, 10);
}

function calcCpfDigit(nums: number[]) {
    let sum = 0;
    for (let i = 0; i < nums.length; i++) {
        sum += nums[i] * (nums.length + 1 - i);
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
}

function generateValidCpf(): string {
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    const d1 = calcCpfDigit(base);
    const d2 = calcCpfDigit([...base, d1]);
    return [...base, d1, d2].join("");
}

async function resolveUniqueCpfForEmail(desiredCpf: string | null, email: string): Promise<string> {
    const existingByEmail = await prisma.user.findUnique({
        where: { email },
        select: { cpf: true },
    });

    if (existingByEmail?.cpf && String(existingByEmail.cpf).trim().length > 0) {
        return String(existingByEmail.cpf);
    }

    let candidate =
        desiredCpf && String(desiredCpf).trim().length > 0 ? String(desiredCpf).trim() : null;

    if (!candidate || candidate.length < 11) {
        candidate = generateValidCpf();
    }

    while (true) {
        const hit = await prisma.user.findUnique({
            where: { cpf: candidate },
            select: { id: true },
        });

        if (!hit) return candidate;

        candidate = generateValidCpf();
    }
}

async function upsertWalletInternal(userId: number) {
    await prisma.cashbackWallet.upsert({
        where: {
            userId_type: {
                userId,
                type: WalletType.INTERNAL,
            },
        },
        create: {
            userId,
            type: WalletType.INTERNAL,
            balance: 0,
        },
        update: {},
    });
}

async function getWalletBalance(userId: number): Promise<number> {
    const wallet = await prisma.cashbackWallet.findUnique({
        where: {
            userId_type: {
                userId,
                type: WalletType.INTERNAL,
            },
        },
        select: { balance: true },
    });

    return wallet?.balance ?? 0;
}

/**
 * Cria CashbackTransaction com idempotência por eventKey.
 * Se criar de fato, aplica incremento/decremento na wallet na MESMA transação.
 */
async function createCashbackTxAndApplyWallet(params: {
    userId: number;
    type: TransactionType;
    source: TransactionSource;
    amount: number;
    eventKey: string;
    relatedId?: string | null;
    referralGroupId?: number | null;
    referralPosition?: number | null;
    meta?: Prisma.InputJsonValue;
}) {
    const eventKey = String(params.eventKey ?? "").trim();
    if (!eventKey) return;

    const userId = Number(params.userId);
    const amount = Number(params.amount);

    if (!userId || Number.isNaN(userId)) return;
    if (!Number.isFinite(amount) || amount <= 0) return;

    await prisma.$transaction(async (tx) => {
        await tx.cashbackWallet.upsert({
            where: {
                userId_type: {
                    userId,
                    type: WalletType.INTERNAL,
                },
            },
            create: {
                userId,
                type: WalletType.INTERNAL,
                balance: 0,
            },
            update: {},
        });

        try {
            await tx.cashbackTransaction.create({
                data: {
                    userId,
                    type: params.type,
                    source: params.source,
                    amount,
                    relatedId: params.relatedId ?? null,
                    eventKey,
                    meta: (params.meta ?? {}) as Prisma.InputJsonValue,
                    expiresAt: null,
                    referralGroupId: params.referralGroupId ?? null,
                    referralPosition: params.referralPosition ?? null,
                },
            });

            if (params.type === TransactionType.EARNED) {
                await tx.cashbackWallet.update({
                    where: {
                        userId_type: {
                            userId,
                            type: WalletType.INTERNAL,
                        },
                    },
                    data: {
                        balance: { increment: amount },
                    },
                });
            }

            if (params.type === TransactionType.USED) {
                await tx.cashbackWallet.update({
                    where: {
                        userId_type: {
                            userId,
                            type: WalletType.INTERNAL,
                        },
                    },
                    data: {
                        balance: { decrement: amount },
                    },
                });
            }
        } catch (err: any) {
            const code = String(err?.code ?? "");
            if (code === "P2002") {
                return;
            }
            throw err;
        }
    });
}

/**
 * ✅ Força um saldo mínimo visível (idempotente e “não destrutivo”).
 * Se wallet < minBalance, cria uma transação EARNED adicional para completar.
 */
async function ensureMinimumVisibleBalance(params: {
    userId: number;
    minBalance: number;
    eventKey: string;
}) {
    const userId = Number(params.userId);
    const minBalance = Number(params.minBalance);

    if (!Number.isFinite(userId) || userId <= 0) return;
    if (!Number.isFinite(minBalance) || minBalance <= 0) return;

    const current = await getWalletBalance(userId);

    if (current >= minBalance) return;

    const diff = Number((minBalance - current).toFixed(2));

    await createCashbackTxAndApplyWallet({
        userId,
        type: TransactionType.EARNED,
        source: TransactionSource.WELCOME_BONUS,
        amount: diff,
        eventKey: params.eventKey,
        meta: {
            seed: true,
            rule: "ENSURE_MIN_VISIBLE_BALANCE",
            desiredMin: minBalance,
            before: current,
            added: diff,
        },
    });
}

/**
 * ✅ Cria/atualiza usuário.
 * Regras especiais:
 * - position=1 (USER1_EMAIL):
 *   - NÃO ALTERA A SENHA se usuário já existir
 *   - Se não existir, cria com senha hash (USER1_PASSWORD_PLAIN)
 * - demais:
 *   - cria com senha hash (TEST_PASSWORD_PLAIN)
 */
async function ensureTestUsers(): Promise<
    Array<{
        id: number;
        name: string;
        email: string;
        referralCode: string | null;
    }>
> {
    log("USERS", "Criando/atualizando usuários fixos para frontend (9 posições)");

    const users: Array<{
        id: number;
        name: string;
        email: string;
        referralCode: string | null;
    }> = [];

    for (let position = 1; position <= 9; position++) {
        log("USERS", `Processando posição ${position}...`);

        const email = makeTestUserEmail(position);
        const desiredName = makeTestUserName(position);
        const desiredReferralCode = makeTestReferralCode(position);
        const phone = `1199999999${position}`;

        const existing = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                name: true,
                email: true,
                referralCode: true,
                cpf: true,
            },
        });

        if (existing?.id) {
            const updates: Record<string, any> = {
                status: UserStatus.ACTIVE,
                role: Role.USER,
            };

            if (!existing.name || String(existing.name).trim().length === 0) {
                updates.name = desiredName;
            }

            if (!existing.referralCode || String(existing.referralCode).trim().length === 0) {
                updates.referralCode = desiredReferralCode;
            }

            await prisma.user.update({
                where: { email },
                data: updates,
            });

            const refreshed = await prisma.user.findUnique({
                where: { email },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    referralCode: true,
                },
            });

            if (!refreshed) {
                throw new Error(`Falha ao reconsultar user ${email} após update.`);
            }

            users.push(refreshed);
            await upsertWalletInternal(refreshed.id);
            continue;
        }

        const cpfDesired = position === 1 ? null : makeTestCpfFallback(position);
        const cpfResolved = await resolveUniqueCpfForEmail(cpfDesired, email);

        const passwordPlain = position === 1 ? USER1_PASSWORD_PLAIN : TEST_PASSWORD_PLAIN;
        const passwordHashed = hashPassword(passwordPlain);

        const created = await prisma.user.create({
            data: {
                name: desiredName,
                email,
                password: passwordHashed,
                phone,
                cpf: cpfResolved,
                role: Role.USER,
                status: UserStatus.ACTIVE,
                referralCode: desiredReferralCode,
                firebaseTokens: [],
            },
            select: {
                id: true,
                name: true,
                email: true,
                referralCode: true,
            },
        });

        users.push(created);
        await upsertWalletInternal(created.id);
    }

    return users;
}

async function ensureReferralPositionConfigs() {
    log("SETUP", "Garantindo ReferralPositionBonusConfig (1..9) para UNIQUE e RECURRENT");

    for (let position = 1; position <= 9; position++) {
        for (const type of [BonusType.UNIQUE, BonusType.RECURRENT]) {
            await prisma.referralPositionBonusConfig.upsert({
                where: {
                    position_type: { position, type },
                },
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
}

async function ensureReferralChain(users: Array<{ id: number; email: string }>) {
    log("REFERRAL", "Garantindo cadeia de indicação (User.referrerId + UserReferral)");

    for (let i = 1; i < users.length; i++) {
        const referrerId = users[i - 1].id;
        const referredId = users[i].id;

        const existing = await prisma.user.findUnique({
            where: { id: referredId },
            select: { referrerId: true },
        });

        if (!existing?.referrerId) {
            await prisma.user.update({
                where: { id: referredId },
                data: { referrerId: referrerId },
            });
        }

        const already = await prisma.userReferral.findUnique({
            where: { referredId },
            select: { id: true },
        });

        if (!already) {
            await prisma.userReferral.create({
                data: {
                    referrerId,
                    referredId,
                    source: "LINK",
                    deviceId: `device-${TEST_PREFIX}-${referredId}`,
                    ip: "127.0.0.1",
                    userAgent: `${TEST_PREFIX} Seed Script`,
                    meta: {
                        seed: true,
                        chain: true,
                        referrerId,
                        referredId,
                    },
                },
            });
        }
    }
}

async function ensureGroupWithPositions(leaderUserId: number) {
    log("GROUP", "Garantindo grupo MLM (com líder posição 1) e posições 1..9");

    const leaderMembership = await prisma.referralGroupMember.findFirst({
        where: {
            userId: leaderUserId,
            position: 1,
            group: { isClosed: false },
        },
        select: { groupId: true },
        orderBy: { joinedAt: "desc" },
    });

    if (leaderMembership?.groupId) {
        return leaderMembership.groupId;
    }

    const group = await prisma.referralGroup.create({
        data: {
            maxMembers: 9,
            cashbackSuspended: false,
            isClosed: false,
        },
        select: { id: true },
    });

    await prisma.referralGroupMember.create({
        data: {
            groupId: group.id,
            userId: leaderUserId,
            position: 1,
        },
    });

    return group.id;
}

async function ensureGroupMembers(groupId: number, users: Array<{ id: number }>) {
    log("GROUP_MEMBERS", "Garantindo membros no grupo (posições 1..9)");

    for (let i = 0; i < users.length; i++) {
        const desiredPosition = i + 1;
        const userId = users[i].id;

        const exists = await prisma.referralGroupMember.findFirst({
            where: { groupId, userId },
            select: { id: true },
        });

        if (exists?.id) continue;

        const posUsed = await prisma.referralGroupMember.findFirst({
            where: { groupId, position: desiredPosition },
            select: { id: true },
        });

        if (!posUsed) {
            await prisma.referralGroupMember.create({
                data: {
                    groupId,
                    userId,
                    position: desiredPosition,
                },
            });
            continue;
        }

        const usedPositions = await prisma.referralGroupMember.findMany({
            where: { groupId },
            select: { position: true },
            orderBy: { position: "asc" },
        });

        const used = new Set(usedPositions.map((p) => Number(p.position)));
        let freePos: number | null = null;

        for (let p = 2; p <= 9; p++) {
            if (!used.has(p)) {
                freePos = p;
                break;
            }
        }

        if (freePos) {
            await prisma.referralGroupMember.create({
                data: {
                    groupId,
                    userId,
                    position: freePos,
                },
            });
        }
    }
}

async function ensureWelcomeCashback(users: Array<{ id: number }>) {
    log("CASHBACK", "Garantindo cashback de cadastro (R$ 20) para todos");

    for (const u of users) {
        const eventKey = `${TEST_PREFIX}:WELCOME:${u.id}`;

        await createCashbackTxAndApplyWallet({
            userId: u.id,
            type: TransactionType.EARNED,
            source: TransactionSource.WELCOME_BONUS,
            amount: 20,
            eventKey,
            meta: {
                seed: true,
                rule: "WELCOME_BONUS",
                amount: 20,
            },
        });
    }
}

async function ensurePlanForFront() {
    log("PLAN", "Garantindo plano de teste para compras no front");

    const planName = `${TEST_PREFIX} Plano Mensal`;

    const plan = await prisma.plan.upsert({
        where: { name: planName },
        create: {
            name: planName,
            price: 100,
            duration: 30,
            description: "Plano de teste para visualizar cashback no front",
            isBestChoice: false,
            periodicityType: "MONTH",
            isPackage: false,
            extraMonths: null,
            maxInstallments: 0,
        },
        update: {
            price: 100,
            duration: 30,
            periodicityType: "MONTH",
            isPackage: false,
        },
        select: { id: true, name: true, price: true },
    });

    return plan;
}

async function ensurePaidPayment(params: {
    userId: number;
    planId: number;
    amount: number;
    paidAt: Date;
    paymentIdAsaas: string;
    cashbackUsedAmount?: number | null;
}) {
    const existing = await prisma.payment.findFirst({
        where: { paymentIdAsaas: params.paymentIdAsaas },
        select: { id: true },
    });

    if (existing?.id) return existing.id;

    const payment = await prisma.payment.create({
        data: {
            userId: params.userId,
            planId: params.planId,
            amount: params.amount,
            status: PaymentStatus.PAID,
            paidAt: params.paidAt,
            channel: PaymentChannel.PIX,
            paymentIdAsaas: params.paymentIdAsaas,
            cashbackUsedAmount: params.cashbackUsedAmount ?? null,
        },
        select: { id: true },
    });

    return payment.id;
}

async function ensureUniqueIndicationCashback(params: {
    groupId: number;
    payerId: number;
    paymentId: number;
    users: Array<{ id: number }>;
    competenceYM: string;
}) {
    log("INDICATION", "Garantindo cashback UNIQUE de indicação (posições 1..8) + ReferralBonus");

    for (let position = 1; position <= 8; position++) {
        const receiver = params.users[position - 1];

        const config = await prisma.referralPositionBonusConfig.findFirst({
            where: { position, type: BonusType.UNIQUE, isActive: true },
            select: { amount: true },
        });

        if (!config || Number(config.amount) <= 0) continue;

        const amount = Number(config.amount);
        const eventKey = `${TEST_PREFIX}:UNIQUE:${params.groupId}:POS:${position}:PAYMENT:${params.paymentId}`;

        const bonusExists = await prisma.referralBonus.findUnique({
            where: { eventKey },
            select: { id: true },
        });

        if (!bonusExists) {
            try {
                await prisma.referralBonus.create({
                    data: {
                        receiverId: receiver.id,
                        payerId: params.payerId,
                        level: position,
                        type: BonusType.UNIQUE,
                        amount,
                        paymentStatus: PaymentStatus.PAID,
                        paymentId: params.paymentId,
                        competenceYearMonth: params.competenceYM,
                        eventKey,
                    },
                });
            } catch (err: any) {
                const code = String(err?.code ?? "");
                if (code !== "P2002") throw err;
            }
        }

        await createCashbackTxAndApplyWallet({
            userId: receiver.id,
            type: TransactionType.EARNED,
            source: TransactionSource.INDICATION,
            amount,
            eventKey,
            relatedId: String(params.paymentId),
            referralGroupId: params.groupId,
            referralPosition: position,
            meta: {
                seed: true,
                rule: "INDICATION_UNIQUE",
                competenceYearMonth: params.competenceYM,
                groupId: params.groupId,
                position,
                payerId: params.payerId,
                paymentId: params.paymentId,
            },
        });
    }
}

async function ensureRecurrentMonthlyIndicationCashback(params: {
    groupId: number;
    users: Array<{ id: number }>;
    competenceYM: string;
}) {
    log("RECURRENT", `Garantindo cashback RECURRENT mensal (competência ${params.competenceYM}) para posições 1..8`);

    for (let position = 1; position <= 8; position++) {
        const receiver = params.users[position - 1];

        const config = await prisma.referralPositionBonusConfig.findFirst({
            where: { position, type: BonusType.RECURRENT, isActive: true },
            select: { amount: true },
        });

        if (!config || Number(config.amount) <= 0) continue;

        const amount = Number(config.amount);
        const eventKey = `${TEST_PREFIX}:RECURRENT:${params.competenceYM}:GROUP:${params.groupId}:POS:${position}`;

        const bonusExists = await prisma.referralBonus.findUnique({
            where: { eventKey },
            select: { id: true },
        });

        if (!bonusExists) {
            try {
                await prisma.referralBonus.create({
                    data: {
                        receiverId: receiver.id,
                        payerId: receiver.id,
                        level: position,
                        type: BonusType.RECURRENT,
                        amount,
                        paymentStatus: PaymentStatus.PAID,
                        paymentId: null,
                        competenceYearMonth: params.competenceYM,
                        eventKey,
                    },
                });
            } catch (err: any) {
                const code = String(err?.code ?? "");
                if (code !== "P2002") throw err;
            }
        }

        await createCashbackTxAndApplyWallet({
            userId: receiver.id,
            type: TransactionType.EARNED,
            source: TransactionSource.INDICATION,
            amount,
            eventKey,
            referralGroupId: params.groupId,
            referralPosition: position,
            meta: {
                seed: true,
                rule: "INDICATION_RECURRENT_MONTHLY",
                competenceYearMonth: params.competenceYM,
                groupId: params.groupId,
                position,
            },
        });
    }
}

async function ensureCashbackUsageScenario(params: {
    userId: number;
    planId: number;
    planPrice: number;
    scenarioKey: string;
    requestedToUse: number;
    paymentAmount: number;
    paidAt: Date;

    /**
     * ✅ Deixa um mínimo na wallet (para “saldo sem uso”).
     * Ex: minRemaining=35 => nunca debita abaixo de 35.
     */
    minRemaining?: number;
}) {
    const maxAllowed = params.planPrice * 0.5;

    const balanceBefore = await getWalletBalance(params.userId);

    const minRemaining = Number(params.minRemaining ?? 0);
    const maxDebitByRemaining =
        minRemaining > 0 ? Math.max(0, balanceBefore - minRemaining) : balanceBefore;

    const applied = Math.min(maxDebitByRemaining, maxAllowed, params.requestedToUse);

    const paymentIdAsaas = `${TEST_PREFIX}:PAY:${params.scenarioKey}:USER:${params.userId}`;
    const paymentId = await ensurePaidPayment({
        userId: params.userId,
        planId: params.planId,
        amount: params.paymentAmount,
        paidAt: params.paidAt,
        paymentIdAsaas,
        cashbackUsedAmount: applied,
    });

    const eventKey = `${TEST_PREFIX}:DEBIT:${params.scenarioKey}:PAYMENT:${paymentId}:USER:${params.userId}`;

    if (applied > 0) {
        await createCashbackTxAndApplyWallet({
            userId: params.userId,
            type: TransactionType.USED,
            source: TransactionSource.SUBSCRIPTION_DEBIT,
            amount: applied,
            eventKey,
            relatedId: String(paymentId),
            meta: {
                seed: true,
                rule: "CASHBACK_USAGE_50_PERCENT_CAP",
                scenarioKey: params.scenarioKey,
                requested: params.requestedToUse,
                maxAllowed,
                applied,
                balanceBefore,
                minRemaining,
                planPrice: params.planPrice,
                paymentId,
            },
        });
    }

    return { paymentId, applied, maxAllowed, balanceBefore, minRemaining };
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------
async function main() {
    log("INIT", "=== SEED PARA FRONT (USUÁRIOS + HISTÓRICO COMPLETO DE CASHBACK) ===");

    log("INFO", `APP_BASE_URL: ${APP_BASE_URL}`);

    if (process.env.DATABASE_URL) {
        log("INFO", `DATABASE_URL: ${maskDbUrl(process.env.DATABASE_URL)}`);
    } else {
        log("WARN", "DATABASE_URL não está definido (o Prisma pode falhar ao conectar).");
    }

    log("INFO", `USER 1 obrigatório: ${USER1_EMAIL} (senha preservada se já existir)`);

    const now = new Date();
    const competenceYM1 = competenceYearMonth(now);

    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const competenceYM2 = competenceYearMonth(nextMonth);

    await ensureReferralPositionConfigs();

    const users = await ensureTestUsers();

    await ensureReferralChain(users.map((u) => ({ id: u.id, email: u.email })));

    const groupId = await ensureGroupWithPositions(users[0].id);
    await ensureGroupMembers(groupId, users.map((u) => ({ id: u.id })));

    await ensureWelcomeCashback(users.map((u) => ({ id: u.id })));

    const plan = await ensurePlanForFront();

    log("PAYMENT", "Criando pagamento PAID do usuário posição 9 (para base do UNIQUE)");

    const payer = users[8];
    const payerPaymentIdAsaas = `${TEST_PREFIX}:PAYER9:PAY:${payer.id}`;
    const payerPaymentId = await ensurePaidPayment({
        userId: payer.id,
        planId: plan.id,
        amount: 100,
        paidAt: now,
        paymentIdAsaas: payerPaymentIdAsaas,
        cashbackUsedAmount: null,
    });

    await ensureUniqueIndicationCashback({
        groupId,
        payerId: payer.id,
        paymentId: payerPaymentId,
        users: users.map((u) => ({ id: u.id })),
        competenceYM: competenceYM1,
    });

    await ensureRecurrentMonthlyIndicationCashback({
        groupId,
        users: users.map((u) => ({ id: u.id })),
        competenceYM: competenceYM1,
    });

    await ensureRecurrentMonthlyIndicationCashback({
        groupId,
        users: users.map((u) => ({ id: u.id })),
        competenceYM: competenceYM2,
    });

    log("DEBIT", "Criando cenários de uso de cashback (limite 50%)");

    // ✅ User 1: deixa saldo mínimo visível (sem uso) para exibir no front
    await ensureCashbackUsageScenario({
        userId: users[0].id,
        planId: plan.id,
        planPrice: plan.price,
        scenarioKey: "SCENARIO_A_USER1_REQUEST_999_KEEP_VISIBLE",
        requestedToUse: 999,
        paymentAmount: plan.price,
        paidAt: now,
        minRemaining: USER1_MIN_VISIBLE_BALANCE,
    });

    await ensureCashbackUsageScenario({
        userId: users[1].id,
        planId: plan.id,
        planPrice: plan.price,
        scenarioKey: "SCENARIO_B_USER2_REQUEST_70",
        requestedToUse: 70,
        paymentAmount: plan.price,
        paidAt: now,
    });

    await ensureCashbackUsageScenario({
        userId: users[2].id,
        planId: plan.id,
        planPrice: plan.price,
        scenarioKey: "SCENARIO_C_USER3_REQUEST_10",
        requestedToUse: 10,
        paymentAmount: plan.price,
        paidAt: now,
    });

    // ✅ GARANTIA FINAL: se por qualquer motivo o saldo do User 1 estiver abaixo do mínimo,
    // cria uma transação adicional idempotente que completa o saldo.
    await ensureMinimumVisibleBalance({
        userId: users[0].id,
        minBalance: USER1_MIN_VISIBLE_BALANCE,
        eventKey: `${TEST_PREFIX}:TOPUP:KEEP_VISIBLE_BALANCE:USER:${users[0].id}`,
    });

    log("REPORT", "=== USUÁRIOS DE TESTE CRIADOS (PARA FRONT) ===");

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const pos = i + 1;

        const walletBalance = await getWalletBalance(u.id);

        const txCount = await prisma.cashbackTransaction.count({
            where: { userId: u.id },
        });

        const referralLink = u.referralCode ? `${APP_BASE_URL}/cadastro?ref=${u.referralCode}` : null;

        console.log("\n--------------------------------------------");
        console.log(`POSIÇÃO: ${pos}`);
        console.log(`ID: ${u.id}`);
        console.log(`NOME: ${u.name}`);
        console.log(`EMAIL: ${u.email}`);

        if (pos === 1) {
            console.log(`SENHA: (PRESERVADA) -> ${USER1_PASSWORD_PLAIN} (somente usada se usuário for criado do zero)`);
            console.log(`SALDO MÍNIMO VISÍVEL GARANTIDO: ${USER1_MIN_VISIBLE_BALANCE}`);
        } else {
            console.log(`SENHA: ${TEST_PASSWORD_PLAIN}`);
        }

        console.log(`REFERRAL CODE: ${u.referralCode}`);
        console.log(`REFERRAL LINK: ${referralLink}`);
        console.log(`SALDO WALLET (INTERNAL): ${walletBalance}`);
        console.log(`TOTAL TRANSAÇÕES CASHBACK: ${txCount}`);
    }

    log("DONE", "=== SEED PARA FRONT FINALIZADO (SEM APAGAR DADOS) ===");
    log("HINT", `No front, User 1 é obrigatoriamente "${USER1_EMAIL}". Os demais têm domínio "@${TEST_EMAIL_DOMAIN}".`);
}

main()
    .catch((e) => {
        console.error("\n❌ ERRO NO SEED PARA FRONT");
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
