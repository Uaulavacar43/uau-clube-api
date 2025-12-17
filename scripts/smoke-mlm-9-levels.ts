/* eslint-disable no-console */
import "dotenv/config";
import crypto from "crypto";
import {
    PrismaClient,
    PaymentStatus,
    TransactionType,
    TransactionSource,
    WalletType,
    BonusType,
    Role,
    UserStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function log(step: string, msg: string, data?: any) {
    console.log(`\n[${step}] ${msg}`);
    if (data) console.dir(data, { depth: null });
}

function assert(cond: any, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function randomEmail(prefix: string) {
    return `${prefix}.${Date.now()}.${crypto.randomInt(1000, 9999)}@test.com`;
}

function randomCpf() {
    return crypto.randomInt(10_000_000_000, 99_999_999_999).toString();
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------
async function main() {
    log("INIT", "=== SMOKE TEST COMPLETO CASHBACK + MLM (ATÉ 9 NÍVEIS) ===");

    // --------------------------------------------------
    // 1) Seed ReferralLevelConfig (1..9)
    // --------------------------------------------------
    log("SETUP", "Garantindo ReferralLevelConfig (1..9)");

    for (let level = 1; level <= 9; level++) {
        await prisma.referralLevelConfig.upsert({
            where: { level },
            create: { level, amount: 10 / level, isActive: true },
            update: {},
        });
    }

    const levelConfig = await prisma.referralLevelConfig.findMany({
        where: { isActive: true },
        orderBy: { level: "asc" },
    });

    assert(levelConfig.length >= 3, "Configuração MLM insuficiente");

    // --------------------------------------------------
    // 2) Criar cadeia MLM (payer + 3 uplines)
    // --------------------------------------------------
    log("USERS", "Criando cadeia MLM (3 níveis)");

    const level3 = await prisma.user.create({
        data: {
            name: "MLM L3",
            email: randomEmail("mlm.l3"),
            password: "123",
            phone: "11900000003",
            cpf: randomCpf(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
        },
    });

    const level2 = await prisma.user.create({
        data: {
            name: "MLM L2",
            email: randomEmail("mlm.l2"),
            password: "123",
            phone: "11900000002",
            cpf: randomCpf(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: level3.id,
        },
    });

    const level1 = await prisma.user.create({
        data: {
            name: "MLM L1",
            email: randomEmail("mlm.l1"),
            password: "123",
            phone: "11900000001",
            cpf: randomCpf(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: level2.id,
        },
    });

    const payer = await prisma.user.create({
        data: {
            name: "PAYER",
            email: randomEmail("payer"),
            password: "123",
            phone: "11999999999",
            cpf: randomCpf(),
            role: Role.USER,
            status: UserStatus.ACTIVE,
            referrerId: level1.id,
        },
    });

    log("USERS", "Cadeia criada", {
        payer: payer.id,
        L1: level1.id,
        L2: level2.id,
        L3: level3.id,
    });

    // --------------------------------------------------
    // 3) Criar carteiras
    // --------------------------------------------------
    for (const u of [level1, level2, level3]) {
        await prisma.cashbackWallet.upsert({
            where: { userId_type: { userId: u.id, type: WalletType.INTERNAL } },
            create: { userId: u.id, type: WalletType.INTERNAL, balance: 0 },
            update: {},
        });
    }

    // --------------------------------------------------
    // 4) Pagamento PAID do payer
    // --------------------------------------------------
    log("PAYMENT", "Criando pagamento PAID");

    const payment = await prisma.payment.create({
        data: {
            userId: payer.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt: new Date(),
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
        },
    });

    // --------------------------------------------------
    // 5) Gerar ReferralBonus + Cashback (UNIQUE + RECURRENT)
    // --------------------------------------------------
    log("BONUS", "Gerando bônus UNIQUE + RECURRENT");

    const receivers = [level1, level2, level3];
    const competenceYM = "2025-01";

    for (const receiver of receivers) {
        const level =
            receiver.id === level1.id ? 1 : receiver.id === level2.id ? 2 : 3;

        const config = levelConfig.find((c) => c.level === level);
        if (!config) throw new Error(`Config não encontrada para nível ${level}`);

        for (const type of [BonusType.UNIQUE, BonusType.RECURRENT]) {
            const eventKey = `${type}:PAYMENT:${payment.id}:L${level}:${receiver.id}`;

            const bonus = await prisma.referralBonus.create({
                data: {
                    receiverId: receiver.id,
                    payerId: payer.id,
                    level,
                    type,
                    amount: config.amount,
                    paymentStatus: "PAID",
                    eventKey,
                    paymentId: payment.id,
                    competenceYearMonth: competenceYM,
                },
            });

            await prisma.cashbackTransaction.create({
                data: {
                    userId: receiver.id,
                    type: TransactionType.EARNED,
                    source: TransactionSource.INDICATION,
                    amount: bonus.amount,
                    relatedId: String(bonus.id),
                    eventKey,
                    meta: {
                        level,
                        type,
                        payerId: payer.id,
                    },
                },
            });

            await prisma.cashbackWallet.update({
                where: {
                    userId_type: {
                        userId: receiver.id,
                        type: WalletType.INTERNAL,
                    },
                },
                data: {
                    balance: { increment: bonus.amount },
                },
            });
        }
    }

    // --------------------------------------------------
    // 6) Usar cashback (regra 50%)
    // --------------------------------------------------
    log("DEBIT", "Usando cashback (50% da mensalidade)");

    const walletL1 = await prisma.cashbackWallet.findUnique({
        where: { userId_type: { userId: level1.id, type: WalletType.INTERNAL } },
    });

    const debitAmount = Math.min(walletL1!.balance, payment.amount * 0.5);

    await prisma.cashbackTransaction.create({
        data: {
            userId: level1.id,
            type: TransactionType.USED,
            source: TransactionSource.SUBSCRIPTION_DEBIT,
            amount: debitAmount,
            relatedId: String(payment.id),
            eventKey: `DEBIT:${payment.id}:L1`,
        },
    });

    await prisma.cashbackWallet.update({
        where: { id: walletL1!.id },
        data: { balance: { decrement: debitAmount } },
    });

    // --------------------------------------------------
    // 7) RELATÓRIO FINAL
    // --------------------------------------------------
    log("REPORT", "=== RELATÓRIO FINAL ===");

    for (const [label, user] of [
        ["L1", level1],
        ["L2", level2],
        ["L3", level3],
    ] as const) {
        const wallet = await prisma.cashbackWallet.findUnique({
            where: { userId_type: { userId: user.id, type: WalletType.INTERNAL } },
        });

        const txs = await prisma.cashbackTransaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
        });

        console.log(`\n--- ${label} (${user.name}) ---`);
        console.log("Saldo final:", wallet?.balance);
        console.log(
            "Transações:",
            txs.map((t) => ({
                type: t.type,
                source: t.source,
                amount: t.amount,
                eventKey: t.eventKey,
            })),
        );
    }

    log("DONE", "=== SMOKE TEST CONCLUÍDO COM SUCESSO ===");
}

// --------------------------------------------------
main()
    .catch((e) => {
        console.error("\n❌ SMOKE TEST FALHOU");
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
