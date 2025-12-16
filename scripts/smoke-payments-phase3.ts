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

async function main() {
    log("INIT", "=== Smoke Test Fase 3: Cashback por ReferralBonus ===");

    // ------------------------------------------------------------------
    // 1) Criar usuários: payer e receiver
    // ------------------------------------------------------------------
    const payer = await prisma.user.create({
        data: {
            name: "Payer Phase3",
            email: `payer.${Date.now()}@test.com`,
            password: "123456",
            phone: "11999999999",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    const receiver = await prisma.user.create({
        data: {
            name: "Receiver Phase3",
            email: `receiver.${Date.now()}@test.com`,
            password: "123456",
            phone: "11888888888",
            cpf: crypto.randomInt(1e10, 9e10).toString(),
            role: "USER",
            status: "ACTIVE",
        },
    });

    log("USERS", "Usuários criados", {
        payerId: payer.id,
        receiverId: receiver.id,
    });

    // ------------------------------------------------------------------
    // 2) Criar carteira do receiver
    // ------------------------------------------------------------------
    const wallet = await prisma.cashbackWallet.create({
        data: {
            userId: receiver.id,
            type: "INTERNAL",
            balance: 0,
        },
    });

    log("WALLET", "Carteira criada", wallet);

    // ------------------------------------------------------------------
    // 3) Criar pagamento PAID
    // ------------------------------------------------------------------
    const payment = await prisma.payment.create({
        data: {
            userId: payer.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt: new Date(),
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
            channel: "PIX",
        },
    });

    log("PAYMENT", "Pagamento PAID criado", payment);

    // ------------------------------------------------------------------
    // 4) Criar ReferralBonus PAID
    // ------------------------------------------------------------------
    const eventKey = `TEST:PHASE3:${payment.id}:${receiver.id}`;

    const bonus = await prisma.referralBonus.create({
        data: {
            receiverId: receiver.id,
            payerId: payer.id,
            level: 1,
            type: "RECURRENT",
            amount: 15,
            paymentStatus: "PAID",
            eventKey,
            paymentId: payment.id,
            competenceYearMonth: "2025-01",
        },
    });

    log("BONUS", "ReferralBonus PAID criado", bonus);

    // ------------------------------------------------------------------
    // 5) Simular crédito de cashback (igual CashbackService)
    // ------------------------------------------------------------------
    const existsTx = await prisma.cashbackTransaction.findUnique({
        where: { eventKey },
    });

    assert(!existsTx, "Já existe transação de cashback (idempotência falhou)");

    await prisma.cashbackTransaction.create({
        data: {
            userId: receiver.id,
            type: "EARNED",
            source: "INDICATION",
            amount: bonus.amount,
            relatedId: String(bonus.id),
            eventKey,
            meta: {
                payerId: payer.id,
                level: bonus.level,
                bonusType: bonus.type,
            },
        },
    });

    await prisma.cashbackWallet.update({
        where: { id: wallet.id },
        data: {
            balance: { increment: bonus.amount },
        },
    });

    log("CASHBACK", "Cashback creditado");

    // ------------------------------------------------------------------
    // 6) ASSERTS FINAIS
    // ------------------------------------------------------------------
    const finalWallet = await prisma.cashbackWallet.findUnique({
        where: { id: wallet.id },
    });

    const txs = await prisma.cashbackTransaction.findMany({
        where: { userId: receiver.id },
    });

    assert(finalWallet?.balance === 15, "Saldo de cashback incorreto");
    assert(txs.length === 1, "Quantidade de transações incorreta");

    log("ASSERT", "Saldo final OK", finalWallet);
    log("DONE", "=== PASS: Fase 3 Cashback OK ===");
}

main()
    .catch((e) => {
        console.error("FAIL PHASE 3", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
