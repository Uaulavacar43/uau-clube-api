/* eslint-disable no-console */
import "dotenv/config";
import { PrismaClient, PaymentStatus } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function log(step: string, msg: string, data?: any) {
    console.log(`[${new Date().toISOString()}] [${step}]`, msg, data ?? "");
}

function assert(cond: any, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function toYearMonth(d: Date) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

async function safeCreateCashbackWallet(userId: number) {
    const existing = await prisma.cashbackWallet.findFirst({
        where: { userId },
    });

    if (existing) return existing;

    return prisma.cashbackWallet.create({
        data: {
            userId,
            type: "INTERNAL",
            balance: 0,
        },
    });
}

/**
 * Simula o crédito de cashback no estilo do seu Phase 3:
 * - valida idempotência via cashbackTransaction.eventKey
 * - cria transaction
 * - incrementa wallet
 */
async function creditCashbackOrThrow(params: {
    receiverId: number;
    amount: number;
    eventKey: string;
    meta: Record<string, any>;
    relatedId: string;
}) {
    const { receiverId, amount, eventKey, meta, relatedId } = params;

    const wallet = await safeCreateCashbackWallet(receiverId);

    const existsTx = await prisma.cashbackTransaction.findUnique({
        where: { eventKey },
    });

    assert(!existsTx, `Idempotência falhou: já existe cashbackTransaction para eventKey=${eventKey}`);

    const tx = await prisma.cashbackTransaction.create({
        data: {
            userId: receiverId,
            type: "EARNED",
            source: "INDICATION",
            amount,
            relatedId,
            eventKey,
            meta,
        },
    });

    await prisma.cashbackWallet.update({
        where: { id: wallet.id },
        data: {
            balance: { increment: amount },
        },
    });

    return { walletId: wallet.id, tx };
}

/**
 * Cria ReferralBonus se não existir pelo eventKey.
 * Retorna o bonus criado ou o existente (dependendo do seu objetivo).
 * Para o smoke test, a gente vai preferir "criar e assert não existia".
 */
async function createReferralBonusOrThrow(params: {
    eventKey: string;
    receiverId: number;
    payerId: number;
    level: number;
    type: "UNIQUE" | "RECURRENT";
    amount: number;
    paymentId: number;
    competenceYearMonth: string;
}) {
    const {
        eventKey,
        receiverId,
        payerId,
        level,
        type,
        amount,
        paymentId,
        competenceYearMonth,
    } = params;

    const existsBonus = await prisma.referralBonus.findUnique({
        where: { eventKey },
    });

    assert(!existsBonus, `Idempotência falhou: já existe referralBonus para eventKey=${eventKey}`);

    const bonus = await prisma.referralBonus.create({
        data: {
            receiverId,
            payerId,
            level,
            type,
            amount,
            paymentStatus: "PAID",
            eventKey,
            paymentId,
            competenceYearMonth,
        },
    });

    return bonus;
}

async function main() {
    log("INIT", "=== Smoke Test Fase 4: MLM (UNIQUE + RECURRENT) + Cashback + Idempotência ===");

    // ------------------------------------------------------------------
    // 0) Setup: criar cadeia MLM (níveis 1,2,3) + payer
    // ------------------------------------------------------------------
    // Aqui não dependemos de campos de referral no User (ex.: referredById),
    // porque o teste valida o output (ReferralBonus + Cashback) e idempotência.
    // Se você tiver campos de relacionamento, você pode complementar depois.
    // ------------------------------------------------------------------

    const lvl3 = await prisma.user.create({
        data: {
            name: "Upline L3 Phase4",
            email: `upline.l3.${Date.now()}@test.com`,
            password: "123456",
            phone: "11333333333",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    const lvl2 = await prisma.user.create({
        data: {
            name: "Upline L2 Phase4",
            email: `upline.l2.${Date.now()}@test.com`,
            password: "123456",
            phone: "11222222222",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    const lvl1 = await prisma.user.create({
        data: {
            name: "Upline L1 Phase4",
            email: `upline.l1.${Date.now()}@test.com`,
            password: "123456",
            phone: "11111111111",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    const payer = await prisma.user.create({
        data: {
            name: "Payer Phase4",
            email: `payer.phase4.${Date.now()}@test.com`,
            password: "123456",
            phone: "11999999999",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    log("USERS", "Cadeia MLM criada", {
        payerId: payer.id,
        level1ReceiverId: lvl1.id,
        level2ReceiverId: lvl2.id,
        level3ReceiverId: lvl3.id,
    });

    // ------------------------------------------------------------------
    // 1) Criar carteiras (wallet) para cada receiver
    // ------------------------------------------------------------------
    const w1 = await safeCreateCashbackWallet(lvl1.id);
    const w2 = await safeCreateCashbackWallet(lvl2.id);
    const w3 = await safeCreateCashbackWallet(lvl3.id);

    log("WALLETS", "Carteiras criadas/garantidas", {
        walletL1: w1,
        walletL2: w2,
        walletL3: w3,
    });

    // ------------------------------------------------------------------
    // 2) Criar pagamento de PLANO (PAID) - base para bônus
    // ------------------------------------------------------------------
    // Obs.: Mantemos o pagamento como "plano" conceitualmente.
    // Se seu Payment tiver planId/subscriptionId, você pode incluir aqui.
    // ------------------------------------------------------------------
    const paidAt = new Date();

    const payment = await prisma.payment.create({
        data: {
            userId: payer.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt,
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
            channel: "PIX",
        },
    });

    log("PAYMENT", "Pagamento PAID criado (base para MLM)", payment);

    const competenceYearMonth = toYearMonth(paidAt);

    // Simulamos um identificador de assinatura/contrato para UNIQUE
    // (no PaymentService real isso é subscriptionId local).
    const subscriptionKey = `SUB:${crypto.randomUUID()}`;

    // ------------------------------------------------------------------
    // 3) Criar bônus UNIQUE (apenas no PRIMEIRO PAID da assinatura)
    // ------------------------------------------------------------------
    // Percentuais/valores de exemplo:
    // - Level 1: 15
    // - Level 2: 10
    // - Level 3: 5
    //
    // Se seus percentuais reais forem diferentes, ajuste aqui.
    // ------------------------------------------------------------------
    const uniqueEventKeyBase = `TEST:PHASE4:UNIQUE:${subscriptionKey}:PAYMENT:${payment.id}`;

    const bonusUniqueL1 = await createReferralBonusOrThrow({
        eventKey: `${uniqueEventKeyBase}:L1:${lvl1.id}`,
        receiverId: lvl1.id,
        payerId: payer.id,
        level: 1,
        type: "UNIQUE",
        amount: 15,
        paymentId: payment.id,
        competenceYearMonth,
    });

    const bonusUniqueL2 = await createReferralBonusOrThrow({
        eventKey: `${uniqueEventKeyBase}:L2:${lvl2.id}`,
        receiverId: lvl2.id,
        payerId: payer.id,
        level: 2,
        type: "UNIQUE",
        amount: 10,
        paymentId: payment.id,
        competenceYearMonth,
    });

    const bonusUniqueL3 = await createReferralBonusOrThrow({
        eventKey: `${uniqueEventKeyBase}:L3:${lvl3.id}`,
        receiverId: lvl3.id,
        payerId: payer.id,
        level: 3,
        type: "UNIQUE",
        amount: 5,
        paymentId: payment.id,
        competenceYearMonth,
    });

    log("BONUS_UNIQUE", "Bônus UNIQUE criados", {
        bonusUniqueL1,
        bonusUniqueL2,
        bonusUniqueL3,
    });

    // ------------------------------------------------------------------
    // 4) Criar bônus RECURRENT (por competência YYYY-MM)
    // ------------------------------------------------------------------
    const recurrentEventKeyBase = `TEST:PHASE4:RECURRENT:${competenceYearMonth}:PAYMENT:${payment.id}`;

    const bonusRecurrentL1 = await createReferralBonusOrThrow({
        eventKey: `${recurrentEventKeyBase}:L1:${lvl1.id}`,
        receiverId: lvl1.id,
        payerId: payer.id,
        level: 1,
        type: "RECURRENT",
        amount: 15,
        paymentId: payment.id,
        competenceYearMonth,
    });

    const bonusRecurrentL2 = await createReferralBonusOrThrow({
        eventKey: `${recurrentEventKeyBase}:L2:${lvl2.id}`,
        receiverId: lvl2.id,
        payerId: payer.id,
        level: 2,
        type: "RECURRENT",
        amount: 10,
        paymentId: payment.id,
        competenceYearMonth,
    });

    const bonusRecurrentL3 = await createReferralBonusOrThrow({
        eventKey: `${recurrentEventKeyBase}:L3:${lvl3.id}`,
        receiverId: lvl3.id,
        payerId: payer.id,
        level: 3,
        type: "RECURRENT",
        amount: 5,
        paymentId: payment.id,
        competenceYearMonth,
    });

    log("BONUS_RECURRENT", "Bônus RECURRENT criados", {
        bonusRecurrentL1,
        bonusRecurrentL2,
        bonusRecurrentL3,
    });

    // ------------------------------------------------------------------
    // 5) Creditar cashback (UNIQUE e RECURRENT) em cada receiver (6 créditos)
    // ------------------------------------------------------------------
    // A regra aqui é a mesma do Phase 3: cashbackTransaction UNIQUE por eventKey.
    // ------------------------------------------------------------------

    // UNIQUE
    await creditCashbackOrThrow({
        receiverId: lvl1.id,
        amount: bonusUniqueL1.amount,
        eventKey: bonusUniqueL1.eventKey,
        relatedId: String(bonusUniqueL1.id),
        meta: {
            payerId: payer.id,
            level: bonusUniqueL1.level,
            bonusType: bonusUniqueL1.type,
            subscriptionKey,
        },
    });

    await creditCashbackOrThrow({
        receiverId: lvl2.id,
        amount: bonusUniqueL2.amount,
        eventKey: bonusUniqueL2.eventKey,
        relatedId: String(bonusUniqueL2.id),
        meta: {
            payerId: payer.id,
            level: bonusUniqueL2.level,
            bonusType: bonusUniqueL2.type,
            subscriptionKey,
        },
    });

    await creditCashbackOrThrow({
        receiverId: lvl3.id,
        amount: bonusUniqueL3.amount,
        eventKey: bonusUniqueL3.eventKey,
        relatedId: String(bonusUniqueL3.id),
        meta: {
            payerId: payer.id,
            level: bonusUniqueL3.level,
            bonusType: bonusUniqueL3.type,
            subscriptionKey,
        },
    });

    // RECURRENT
    await creditCashbackOrThrow({
        receiverId: lvl1.id,
        amount: bonusRecurrentL1.amount,
        eventKey: bonusRecurrentL1.eventKey,
        relatedId: String(bonusRecurrentL1.id),
        meta: {
            payerId: payer.id,
            level: bonusRecurrentL1.level,
            bonusType: bonusRecurrentL1.type,
            competenceYearMonth,
        },
    });

    await creditCashbackOrThrow({
        receiverId: lvl2.id,
        amount: bonusRecurrentL2.amount,
        eventKey: bonusRecurrentL2.eventKey,
        relatedId: String(bonusRecurrentL2.id),
        meta: {
            payerId: payer.id,
            level: bonusRecurrentL2.level,
            bonusType: bonusRecurrentL2.type,
            competenceYearMonth,
        },
    });

    await creditCashbackOrThrow({
        receiverId: lvl3.id,
        amount: bonusRecurrentL3.amount,
        eventKey: bonusRecurrentL3.eventKey,
        relatedId: String(bonusRecurrentL3.id),
        meta: {
            payerId: payer.id,
            level: bonusRecurrentL3.level,
            bonusType: bonusRecurrentL3.type,
            competenceYearMonth,
        },
    });

    log("CASHBACK", "Cashback creditado para UNIQUE + RECURRENT em níveis 1..3");

    // ------------------------------------------------------------------
    // 6) ASSERTS: saldo final e quantidade de transações
    // ------------------------------------------------------------------
    const finalW1 = await prisma.cashbackWallet.findUnique({ where: { id: w1.id } });
    const finalW2 = await prisma.cashbackWallet.findUnique({ where: { id: w2.id } });
    const finalW3 = await prisma.cashbackWallet.findUnique({ where: { id: w3.id } });

    const txsL1 = await prisma.cashbackTransaction.findMany({
        where: { userId: lvl1.id },
    });
    const txsL2 = await prisma.cashbackTransaction.findMany({
        where: { userId: lvl2.id },
    });
    const txsL3 = await prisma.cashbackTransaction.findMany({
        where: { userId: lvl3.id },
    });

    // cada receiver recebe 2 créditos: UNIQUE + RECURRENT
    assert(txsL1.length === 2, "L1 deve ter exatamente 2 transações (UNIQUE + RECURRENT)");
    assert(txsL2.length === 2, "L2 deve ter exatamente 2 transações (UNIQUE + RECURRENT)");
    assert(txsL3.length === 2, "L3 deve ter exatamente 2 transações (UNIQUE + RECURRENT)");

    // saldo esperado (UNIQUE + RECURRENT) = (15+15)=30, (10+10)=20, (5+5)=10
    assert(finalW1?.balance === 30, `Saldo L1 incorreto: esperado 30, obtido ${finalW1?.balance}`);
    assert(finalW2?.balance === 20, `Saldo L2 incorreto: esperado 20, obtido ${finalW2?.balance}`);
    assert(finalW3?.balance === 10, `Saldo L3 incorreto: esperado 10, obtido ${finalW3?.balance}`);

    log("ASSERT", "Saldos finais OK", {
        L1: finalW1,
        L2: finalW2,
        L3: finalW3,
    });

    // ------------------------------------------------------------------
    // 7) ASSERTS DE IDEMPOTÊNCIA
    // ------------------------------------------------------------------
    // 7.1) cashbackTransaction idempotente por eventKey
    // Tentamos creditar novamente um dos bônus (deve falhar).
    // ------------------------------------------------------------------
    let idempotencyTxOk = false;
    try {
        await creditCashbackOrThrow({
            receiverId: lvl1.id,
            amount: bonusUniqueL1.amount,
            eventKey: bonusUniqueL1.eventKey,
            relatedId: String(bonusUniqueL1.id),
            meta: {
                payerId: payer.id,
                level: bonusUniqueL1.level,
                bonusType: bonusUniqueL1.type,
                subscriptionKey,
            },
        });
    } catch (e: any) {
        idempotencyTxOk = true;
        log("IDEMPOTENCY_TX", "OK: bloqueou duplicidade de cashbackTransaction", {
            error: e?.message,
        });
    }

    assert(idempotencyTxOk, "Idempotência de cashbackTransaction falhou: deveria bloquear duplicidade");

    // 7.2) referralBonus idempotente por eventKey
    // Tentamos criar o mesmo bônus novamente (deve falhar).
    // ------------------------------------------------------------------
    let idempotencyBonusOk = false;
    try {
        await createReferralBonusOrThrow({
            eventKey: bonusRecurrentL1.eventKey,
            receiverId: lvl1.id,
            payerId: payer.id,
            level: 1,
            type: "RECURRENT",
            amount: 15,
            paymentId: payment.id,
            competenceYearMonth,
        });
    } catch (e: any) {
        idempotencyBonusOk = true;
        log("IDEMPOTENCY_BONUS", "OK: bloqueou duplicidade de referralBonus", {
            error: e?.message,
        });
    }

    assert(idempotencyBonusOk, "Idempotência de referralBonus falhou: deveria bloquear duplicidade");

    log("DONE", "=== PASS: Fase 4 MLM (UNIQUE + RECURRENT) + Cashback + Idempotência OK ===");
}

main()
    .catch((e) => {
        console.error("FAIL PHASE 4", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
