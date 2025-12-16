/* eslint-disable no-console */
import "dotenv/config";
import crypto from "crypto";
import {
    Prisma,
    PrismaClient,
    PaymentStatus,
    Role,
    UserStatus,
    WalletType,
    TransactionType,
    TransactionSource,
    BonusType,
    PaymentChannel,
    DiscountType,
} from "@prisma/client";

// ----------------------------
// CLI args
// ----------------------------
function getArgValue(name: string): string | undefined {
    const prefix = `--${name}=`;
    const found = process.argv.find((a) => a.startsWith(prefix));
    if (!found) return undefined;
    return found.slice(prefix.length).trim() || undefined;
}

const dbUrlArg = getArgValue("db-url");
const dbUrl = dbUrlArg ?? process.env.DATABASE_URL;

if (!dbUrl) {
    console.error("ERROR: DATABASE_URL ausente. Use --db-url=... ou export DATABASE_URL.");
    process.exit(1);
}

const prisma = new PrismaClient({
    datasources: {
        db: { url: dbUrl },
    },
});

// ----------------------------
// Helpers (log/assert/time/id)
// ----------------------------
function log(step: string, msg: string, data?: any) {
    console.log(`[${new Date().toISOString()}] [${step}]`, msg, data ?? "");
}

function assert(cond: any, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function competenceYearMonthFrom(date: Date): string {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}-${pad2(m)}`;
}

function randomCpf11(): string {
    // 11 dígitos
    return crypto.randomInt(10_000_000_000, 99_999_999_999).toString();
}

function randomEmail(prefix: string): string {
    return `${prefix}.${Date.now()}.${crypto.randomInt(1000, 9999)}@test.com`;
}

function knownRequestErrorCode(e: unknown): string | undefined {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
    return undefined;
}

function isUniqueConstraintError(e: unknown): boolean {
    return knownRequestErrorCode(e) === "P2002";
}

async function ensureWallet(userId: number) {
    // Wallet tem @@unique([userId, type])
    const wallet = await prisma.cashbackWallet.upsert({
        where: { userId_type: { userId, type: WalletType.INTERNAL } },
        create: { userId, type: WalletType.INTERNAL, balance: 0 },
        update: {},
    });
    return wallet;
}

async function creditCashbackIdempotent(params: {
    receiverId: number;
    eventKey: string;
    amount: number;
    meta?: any;
    relatedId?: string;
}) {
    const { receiverId, eventKey, amount, meta, relatedId } = params;

    const exists = await prisma.cashbackTransaction.findUnique({
        where: { eventKey },
    });

    if (exists) {
        throw new Error(`Idempotência falhou: já existe cashbackTransaction para eventKey=${eventKey}`);
    }

    await prisma.cashbackTransaction.create({
        data: {
            userId: receiverId,
            type: TransactionType.EARNED,
            source: TransactionSource.INDICATION,
            amount,
            relatedId: relatedId ?? null,
            eventKey,
            meta: meta ?? {},
        },
    });

    await prisma.cashbackWallet.update({
        where: { userId_type: { userId: receiverId, type: WalletType.INTERNAL } },
        data: { balance: { increment: amount } },
    });
}

// ----------------------------
// Business helpers (Fase 2)
// ----------------------------
const MINIMUM_CHARGE_AMOUNT = 1;

type CouponLike = {
    discountType: DiscountType;
    discountValue: number;
};

function ensureMinimumAmount(value: number, minimum = MINIMUM_CHARGE_AMOUNT): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return minimum;
    if (n <= 0) return minimum;
    return Number(n.toFixed(2));
}

/**
 * Regra Fase 2: cupom nunca pode zerar cobrança.
 * - aplica desconto com cap: final >= minimumCharge
 * - retorna finalAmount
 */
function applyCouponWithMinimumCharge(
    baseAmount: number,
    coupon: CouponLike | null,
    minimumCharge: number = MINIMUM_CHARGE_AMOUNT,
): { finalAmount: number; appliedDiscount: number } {
    if (!coupon) return { finalAmount: ensureMinimumAmount(baseAmount, minimumCharge), appliedDiscount: 0 };

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
        return { finalAmount: ensureMinimumAmount(final, minCharge), appliedDiscount: Number(applied.toFixed(2)) };
    }

    // FIXED
    const requested = Number(coupon.discountValue) || 0;
    const applied = Math.min(requested, maxDiscount);
    const final = base - applied;
    return { finalAmount: ensureMinimumAmount(final, minCharge), appliedDiscount: Number(applied.toFixed(2)) };
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
    log("INIT", "=== Smoke Test Fase 1–4: Schema + Cupom(min) + Cashback + MLM + Idempotência ===");

    const now = new Date();
    const competenceYM = competenceYearMonthFrom(now);

    // =========================================================
    // FASE 1: Criação de User respeitando schema (role obrigatório)
    // =========================================================
    log("PHASE1", "Criando usuário base (schema ok: role obrigatório) ...");

    const userPhase1 = await prisma.user.create({
        data: {
            name: "User Phase1",
            email: randomEmail("phase1"),
            password: "123456",
            phone: "11999990000",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
        },
    });

    log("PHASE1", "User criado", { id: userPhase1.id, role: userPhase1.role, status: userPhase1.status });

    // =========================================================
    // FASE 2: Cupom nunca zera cobrança (mínimo a pagar) + Plan/Coupon/Payment coerentes
    // =========================================================
    log("PHASE2", "Criando Plan + Coupons e validando regra de mínimo a pagar ...");

    const plan = await prisma.plan.create({
        data: {
            name: `Plan Phase2 ${Date.now()}-${crypto.randomInt(1000, 9999)}`,
            price: 100,
            duration: 30,
            description: "Plano criado para smoke test Fase 2",
            periodicityType: "MONTH",
            isPackage: true,
            isBestChoice: false,
            maxInstallments: 0,
        },
    });

    const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const coupon100Percent = await prisma.coupon.create({
        data: {
            code: `CUPOM100P-${Date.now()}-${crypto.randomInt(1000, 9999)}`,
            description: "Cupom 100% (deve ser capado para mínimo a pagar)",
            additionalInfo: "Smoke test Fase 2",
            discountType: DiscountType.PERCENTAGE,
            discountValue: 100,
            maxDiscountValue: null,
            validFrom,
            validUntil,
            isActive: true,
            usageLimit: null,
            currentUsage: 0,
            plans: {
                connect: [{ id: plan.id }],
            },
        },
    });

    const couponFixedHigh = await prisma.coupon.create({
        data: {
            code: `CUPOMFIX-${Date.now()}-${crypto.randomInt(1000, 9999)}`,
            description: "Cupom FIXED alto (deve ser capado para mínimo a pagar)",
            additionalInfo: "Smoke test Fase 2",
            discountType: DiscountType.FIXED,
            discountValue: 999999,
            maxDiscountValue: null,
            validFrom,
            validUntil,
            isActive: true,
            usageLimit: null,
            currentUsage: 0,
            plans: {
                connect: [{ id: plan.id }],
            },
        },
    });

    const pricingPercent = applyCouponWithMinimumCharge(plan.price, {
        discountType: coupon100Percent.discountType,
        discountValue: coupon100Percent.discountValue,
    });

    const pricingFixed = applyCouponWithMinimumCharge(plan.price, {
        discountType: couponFixedHigh.discountType,
        discountValue: couponFixedHigh.discountValue,
    });

    log("PHASE2", "Pricing com cupom 100% e FIXED alto", {
        base: plan.price,
        percent100: pricingPercent,
        fixedHigh: pricingFixed,
        minimumCharge: MINIMUM_CHARGE_AMOUNT,
    });

    assert(pricingPercent.finalAmount >= MINIMUM_CHARGE_AMOUNT, "Fase 2 falhou: cupom % zerou cobrança");
    assert(pricingFixed.finalAmount >= MINIMUM_CHARGE_AMOUNT, "Fase 2 falhou: cupom FIXED zerou cobrança");

    // Cria Payment coerente (simulando valor final já capado)
    const paymentPhase2 = await prisma.payment.create({
        data: {
            userId: userPhase1.id,
            planId: plan.id,
            couponId: coupon100Percent.id,
            amount: ensureMinimumAmount(pricingPercent.finalAmount, MINIMUM_CHARGE_AMOUNT),
            status: PaymentStatus.PAID,
            paidAt: now,
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
            channel: PaymentChannel.PIX,
        },
    });

    log("PHASE2", "Payment criado com amount >= mínimo", {
        paymentId: paymentPhase2.id,
        amount: paymentPhase2.amount,
        planId: paymentPhase2.planId,
        couponId: paymentPhase2.couponId,
    });

    assert(paymentPhase2.amount >= MINIMUM_CHARGE_AMOUNT, "Fase 2 falhou: payment.amount ficou < mínimo");

    // =========================================================
    // FASE 3: Cashback por ReferralBonus (1 nível) + idempotência de tx
    // =========================================================
    log("PHASE3", "Criando payer/receiver e testando cashback por ReferralBonus (1 nível) ...");

    const payerP3 = await prisma.user.create({
        data: {
            name: "Payer Phase3",
            email: randomEmail("payer.phase3"),
            password: "123456",
            phone: "11911111111",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
        },
    });

    const receiverP3 = await prisma.user.create({
        data: {
            name: "Receiver Phase3",
            email: randomEmail("receiver.phase3"),
            password: "123456",
            phone: "11922222222",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
        },
    });

    await ensureWallet(receiverP3.id);

    const paymentP3 = await prisma.payment.create({
        data: {
            userId: payerP3.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt: now,
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
            channel: PaymentChannel.PIX,
        },
    });

    const eventKeyP3 = `TEST:PHASE3:${paymentP3.id}:${receiverP3.id}`;

    const bonusP3 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverP3.id,
            payerId: payerP3.id,
            level: 1,
            type: BonusType.RECURRENT,
            amount: 15,
            paymentStatus: "PAID",
            eventKey: eventKeyP3,
            paymentId: paymentP3.id,
            competenceYearMonth: competenceYM,
        },
    });

    await creditCashbackIdempotent({
        receiverId: receiverP3.id,
        eventKey: eventKeyP3,
        amount: bonusP3.amount,
        relatedId: String(bonusP3.id),
        meta: { payerId: payerP3.id, level: 1, bonusType: bonusP3.type },
    });

    const walletP3 = await prisma.cashbackWallet.findUnique({
        where: { userId_type: { userId: receiverP3.id, type: WalletType.INTERNAL } },
    });

    const txsP3 = await prisma.cashbackTransaction.findMany({
        where: { userId: receiverP3.id },
    });

    log("PHASE3", "Saldo e txs", { wallet: walletP3, txCount: txsP3.length });

    assert(walletP3?.balance === 15, "Fase 3 falhou: saldo cashback incorreto (esperado 15)");
    assert(txsP3.length === 1, "Fase 3 falhou: quantidade de transações incorreta (esperado 1)");

    // Idempotência TX (deve bloquear)
    try {
        await creditCashbackIdempotent({
            receiverId: receiverP3.id,
            eventKey: eventKeyP3,
            amount: bonusP3.amount,
            relatedId: String(bonusP3.id),
            meta: { duplicate: true },
        });
        throw new Error("Fase 3 falhou: era para bloquear cashbackTransaction duplicada");
    } catch (e) {
        log("PHASE3_IDEMPOTENCY_TX", "OK: bloqueou duplicidade de cashbackTransaction", {
            error: (e as Error)?.message ?? String(e),
        });
    }

    // =========================================================
    // FASE 4: MLM (3 níveis) + UNIQUE + RECURRENT + cashback + idempotência
    // =========================================================
    log("PHASE4", "Criando cadeia MLM (3 níveis) e testando UNIQUE + RECURRENT + cashback + idempotência ...");

    // Users MLM
    const receiverL3 = await prisma.user.create({
        data: {
            name: "Receiver L3 Phase4",
            email: randomEmail("mlm.l3"),
            password: "123456",
            phone: "11800000003",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
        },
    });

    const receiverL2 = await prisma.user.create({
        data: {
            name: "Receiver L2 Phase4",
            email: randomEmail("mlm.l2"),
            password: "123456",
            phone: "11800000002",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: receiverL3.id,
        },
    });

    const receiverL1 = await prisma.user.create({
        data: {
            name: "Receiver L1 Phase4",
            email: randomEmail("mlm.l1"),
            password: "123456",
            phone: "11800000001",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: receiverL2.id,
        },
    });

    const payer = await prisma.user.create({
        data: {
            name: "Payer Phase4",
            email: randomEmail("mlm.payer"),
            password: "123456",
            phone: "11700000000",
            cpf: randomCpf11(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: receiverL1.id,
        },
    });

    // (Opcional) Registrar trilha em UserReferral (não é obrigatório para os bônus em si,
    // mas ajuda a manter o dataset consistente com o domínio)
    await prisma.userReferral.create({
        data: {
            referrerId: receiverL1.id,
            referredId: payer.id,
            source: "UNKNOWN",
            meta: { smoke: "phase4" },
        },
    });
    await prisma.userReferral.create({
        data: {
            referrerId: receiverL2.id,
            referredId: receiverL1.id,
            source: "UNKNOWN",
            meta: { smoke: "phase4" },
        },
    });
    await prisma.userReferral.create({
        data: {
            referrerId: receiverL3.id,
            referredId: receiverL2.id,
            source: "UNKNOWN",
            meta: { smoke: "phase4" },
        },
    });

    log("PHASE4", "Cadeia MLM criada", {
        payerId: payer.id,
        level1ReceiverId: receiverL1.id,
        level2ReceiverId: receiverL2.id,
        level3ReceiverId: receiverL3.id,
    });

    const walletL1 = await ensureWallet(receiverL1.id);
    const walletL2 = await ensureWallet(receiverL2.id);
    const walletL3 = await ensureWallet(receiverL3.id);

    log("PHASE4", "Carteiras criadas/garantidas", { walletL1, walletL2, walletL3 });

    // Payment base (pode ser plano ou não; aqui é “base para bônus”)
    const paymentP4 = await prisma.payment.create({
        data: {
            userId: payer.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt: now,
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
            channel: PaymentChannel.PIX,
        },
    });

    log("PHASE4", "Pagamento PAID criado (base para MLM)", paymentP4);

    // Distribuição MLM (ajuste aqui se seus percentuais mudarem)
    const MLM = {
        L1: { level: 1, amount: 15 },
        L2: { level: 2, amount: 10 },
        L3: { level: 3, amount: 5 },
    } as const;

    const subscriptionUuid = crypto.randomUUID();

    // UNIQUE (primeiro pagamento da assinatura)
    const uniqueKeys = {
        L1: `TEST:PHASE4:UNIQUE:SUB:${subscriptionUuid}:PAYMENT:${paymentP4.id}:L1:${receiverL1.id}`,
        L2: `TEST:PHASE4:UNIQUE:SUB:${subscriptionUuid}:PAYMENT:${paymentP4.id}:L2:${receiverL2.id}`,
        L3: `TEST:PHASE4:UNIQUE:SUB:${subscriptionUuid}:PAYMENT:${paymentP4.id}:L3:${receiverL3.id}`,
    };

    const bonusUniqueL1 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL1.id,
            payerId: payer.id,
            level: MLM.L1.level,
            type: BonusType.UNIQUE,
            amount: MLM.L1.amount,
            paymentStatus: "PAID",
            eventKey: uniqueKeys.L1,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    const bonusUniqueL2 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL2.id,
            payerId: payer.id,
            level: MLM.L2.level,
            type: BonusType.UNIQUE,
            amount: MLM.L2.amount,
            paymentStatus: "PAID",
            eventKey: uniqueKeys.L2,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    const bonusUniqueL3 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL3.id,
            payerId: payer.id,
            level: MLM.L3.level,
            type: BonusType.UNIQUE,
            amount: MLM.L3.amount,
            paymentStatus: "PAID",
            eventKey: uniqueKeys.L3,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    log("PHASE4_UNIQUE", "Bônus UNIQUE criados", { bonusUniqueL1, bonusUniqueL2, bonusUniqueL3 });

    // RECURRENT (por competência)
    const recurrentKeys = {
        L1: `TEST:PHASE4:RECURRENT:${competenceYM}:PAYMENT:${paymentP4.id}:L1:${receiverL1.id}`,
        L2: `TEST:PHASE4:RECURRENT:${competenceYM}:PAYMENT:${paymentP4.id}:L2:${receiverL2.id}`,
        L3: `TEST:PHASE4:RECURRENT:${competenceYM}:PAYMENT:${paymentP4.id}:L3:${receiverL3.id}`,
    };

    const bonusRecurrentL1 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL1.id,
            payerId: payer.id,
            level: MLM.L1.level,
            type: BonusType.RECURRENT,
            amount: MLM.L1.amount,
            paymentStatus: "PAID",
            eventKey: recurrentKeys.L1,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    const bonusRecurrentL2 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL2.id,
            payerId: payer.id,
            level: MLM.L2.level,
            type: BonusType.RECURRENT,
            amount: MLM.L2.amount,
            paymentStatus: "PAID",
            eventKey: recurrentKeys.L2,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    const bonusRecurrentL3 = await prisma.referralBonus.create({
        data: {
            receiverId: receiverL3.id,
            payerId: payer.id,
            level: MLM.L3.level,
            type: BonusType.RECURRENT,
            amount: MLM.L3.amount,
            paymentStatus: "PAID",
            eventKey: recurrentKeys.L3,
            paymentId: paymentP4.id,
            competenceYearMonth: competenceYM,
        },
    });

    log("PHASE4_RECURRENT", "Bônus RECURRENT criados", {
        bonusRecurrentL1,
        bonusRecurrentL2,
        bonusRecurrentL3,
    });

    // Creditar cashback para UNIQUE + RECURRENT (níveis 1..3)
    const allBonuses = [
        bonusUniqueL1,
        bonusUniqueL2,
        bonusUniqueL3,
        bonusRecurrentL1,
        bonusRecurrentL2,
        bonusRecurrentL3,
    ];

    for (const b of allBonuses) {
        await creditCashbackIdempotent({
            receiverId: b.receiverId,
            eventKey: b.eventKey,
            amount: b.amount,
            relatedId: String(b.id),
            meta: {
                payerId: b.payerId,
                level: b.level,
                bonusType: b.type,
                competenceYearMonth: b.competenceYearMonth,
                paymentId: b.paymentId,
            },
        });
    }

    log("PHASE4_CASHBACK", "Cashback creditado para UNIQUE + RECURRENT em níveis 1..3");

    // ASSERT saldos finais esperados
    const finalL1 = await prisma.cashbackWallet.findUnique({
        where: { userId_type: { userId: receiverL1.id, type: WalletType.INTERNAL } },
    });
    const finalL2 = await prisma.cashbackWallet.findUnique({
        where: { userId_type: { userId: receiverL2.id, type: WalletType.INTERNAL } },
    });
    const finalL3 = await prisma.cashbackWallet.findUnique({
        where: { userId_type: { userId: receiverL3.id, type: WalletType.INTERNAL } },
    });

    log("PHASE4_ASSERT", "Saldos finais (L1/L2/L3)", { L1: finalL1, L2: finalL2, L3: finalL3 });

    assert(finalL1?.balance === MLM.L1.amount * 2, "Fase 4 falhou: saldo L1 incorreto (esperado UNIQUE+RECURRENT)");
    assert(finalL2?.balance === MLM.L2.amount * 2, "Fase 4 falhou: saldo L2 incorreto (esperado UNIQUE+RECURRENT)");
    assert(finalL3?.balance === MLM.L3.amount * 2, "Fase 4 falhou: saldo L3 incorreto (esperado UNIQUE+RECURRENT)");

    // ASSERT transações (2 por receiver: UNIQUE + RECURRENT)
    const txL1 = await prisma.cashbackTransaction.findMany({ where: { userId: receiverL1.id } });
    const txL2 = await prisma.cashbackTransaction.findMany({ where: { userId: receiverL2.id } });
    const txL3 = await prisma.cashbackTransaction.findMany({ where: { userId: receiverL3.id } });

    assert(txL1.length === 2, "Fase 4 falhou: tx count L1 incorreto (esperado 2)");
    assert(txL2.length === 2, "Fase 4 falhou: tx count L2 incorreto (esperado 2)");
    assert(txL3.length === 2, "Fase 4 falhou: tx count L3 incorreto (esperado 2)");

    // Idempotência TX (deve bloquear)
    try {
        await creditCashbackIdempotent({
            receiverId: receiverL1.id,
            eventKey: bonusUniqueL1.eventKey,
            amount: bonusUniqueL1.amount,
            relatedId: String(bonusUniqueL1.id),
            meta: { duplicate: true },
        });
        throw new Error("Fase 4 falhou: era para bloquear cashbackTransaction duplicada (UNIQUE L1)");
    } catch (e) {
        log("PHASE4_IDEMPOTENCY_TX", "OK: bloqueou duplicidade de cashbackTransaction", {
            error: (e as Error)?.message ?? String(e),
        });
    }

    // Idempotência ReferralBonus (unique constraint em eventKey)
    try {
        await prisma.referralBonus.create({
            data: {
                receiverId: receiverL1.id,
                payerId: payer.id,
                level: MLM.L1.level,
                type: BonusType.RECURRENT,
                amount: MLM.L1.amount,
                paymentStatus: "PAID",
                eventKey: bonusRecurrentL1.eventKey, // MESMA CHAVE
                paymentId: paymentP4.id,
                competenceYearMonth: competenceYM,
            },
        });

        throw new Error("Fase 4 falhou: era para bloquear referralBonus duplicado por eventKey");
    } catch (e) {
        if (!isUniqueConstraintError(e)) {
            throw e;
        }
        log("PHASE4_IDEMPOTENCY_BONUS", "OK: bloqueou duplicidade de referralBonus (unique eventKey)", {
            error: (e as Error)?.message ?? String(e),
            prismaCode: knownRequestErrorCode(e),
        });
    }

    log("DONE", "=== PASS: Smoke Test Fase 1–4 OK (Schema + Cupom(min) + Cashback + MLM + Idempotência) ===");
}

main()
    .catch((e) => {
        console.error("FAIL PHASES 1–4", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
