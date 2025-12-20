/* eslint-disable no-console */
import "dotenv/config";
import crypto from "crypto";
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

function competenceYearMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------
async function main() {
    log("INIT", "=== SMOKE TEST MLM COMPLETO (TODAS AS REGRAS DEFINITIVAS) ===");

    const now = new Date();
    const competenceYM1 = competenceYearMonth(now);

    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const competenceYM2 = competenceYearMonth(nextMonth);

    // --------------------------------------------------
    // 1) CONFIGURAÇÃO DE BÔNUS POR POSIÇÃO
    // --------------------------------------------------
    log("SETUP", "Garantindo ReferralPositionBonusConfig (1..9)");

    for (let position = 1; position <= 9; position++) {
        for (const type of [BonusType.UNIQUE, BonusType.RECURRENT]) {
            await prisma.referralPositionBonusConfig.upsert({
                where: {
                    position_type: {
                        position,
                        type,
                    },
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

    // --------------------------------------------------
    // 2) CRIAR GRUPO
    // --------------------------------------------------
    log("GROUP", "Criando grupo fechado (9 posições)");

    const group = await prisma.referralGroup.create({
        data: {
            maxMembers: 9,
            cashbackSuspended: false,
            isClosed: false,
        },
    });

    // --------------------------------------------------
    // 3) CRIAR 9 USUÁRIOS + WALLET + CASHBACK DE CADASTRO (R$ 20)
    // --------------------------------------------------
    log("USERS", "Criando usuários e cashback de cadastro");

    const users = [];

    for (let i = 1; i <= 9; i++) {
        const user = await prisma.user.create({
            data: {
                name: `User MLM ${i}`,
                email: randomEmail(`mlm.${i}`),
                password: "123456",
                phone: `1190000000${i}`,
                cpf: randomCpf(),
                role: Role.USER,
                status: UserStatus.ACTIVE,
                referralCode: crypto.randomUUID().slice(0, 8),
            },
        });

        users.push(user);

        await prisma.cashbackWallet.create({
            data: {
                userId: user.id,
                type: WalletType.INTERNAL,
                balance: 0,
            },
        });

        // Cashback de cadastro = R$ 20
        await prisma.cashbackTransaction.create({
            data: {
                userId: user.id,
                type: TransactionType.EARNED,
                source: TransactionSource.WELCOME_BONUS,
                amount: 20,
                eventKey: `WELCOME:${user.id}`,
            },
        });

        await prisma.cashbackWallet.update({
            where: {
                userId_type: {
                    userId: user.id,
                    type: WalletType.INTERNAL,
                },
            },
            data: {
                balance: { increment: 20 },
            },
        });
    }

    // --------------------------------------------------
    // 4) INSERIR USUÁRIOS NO GRUPO (POSIÇÃO 1..9)
    // --------------------------------------------------
    log("GROUP_MEMBERS", "Inserindo usuários no grupo");

    for (let i = 0; i < users.length; i++) {
        await prisma.referralGroupMember.create({
            data: {
                groupId: group.id,
                userId: users[i].id,
                position: i + 1,
            },
        });
    }

    // --------------------------------------------------
    // 5) CRIAR PLANO
    // --------------------------------------------------
    log("PLAN", "Criando plano mensal");

    const plan = await prisma.plan.create({
        data: {
            name: `Plano Mensal ${Date.now()}`,
            price: 100,
            duration: 30,
            isPackage: false,
            periodicityType: "MONTH",
            maxInstallments: 0,
        },
    });

    // --------------------------------------------------
    // 6) PAGAMENTO DO USUÁRIO POSIÇÃO 9
    // --------------------------------------------------
    log("PAYMENT", "Criando pagamento PAID (posição 9)");

    const payer = users[8];

    const payment = await prisma.payment.create({
        data: {
            userId: payer.id,
            planId: plan.id,
            amount: 100,
            status: PaymentStatus.PAID,
            paidAt: now,
            channel: PaymentChannel.PIX,
            paymentIdAsaas: `pay_${crypto.randomUUID()}`,
        },
    });

    // --------------------------------------------------
    // 7) BÔNUS UNIQUE (1x)
    // --------------------------------------------------
    log("BONUS", "Gerando bônus UNIQUE");

    for (let position = 1; position <= 8; position++) {
        const receiver = users[position - 1];

        const config = await prisma.referralPositionBonusConfig.findFirst({
            where: { position, type: BonusType.UNIQUE },
        });

        if (!config || config.amount <= 0) continue;

        const eventKey = `UNIQUE:${group.id}:${position}:${payment.id}`;

        await prisma.referralBonus.create({
            data: {
                receiverId: receiver.id,
                payerId: payer.id,
                level: position,
                type: BonusType.UNIQUE,
                amount: config.amount,
                paymentStatus: PaymentStatus.PAID,
                paymentId: payment.id,
                competenceYearMonth: competenceYM1,
                eventKey,
            },
        });

        await prisma.cashbackTransaction.create({
            data: {
                userId: receiver.id,
                type: TransactionType.EARNED,
                source: TransactionSource.INDICATION,
                amount: config.amount,
                eventKey,
                referralGroupId: group.id,
                referralPosition: position,
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
                balance: { increment: config.amount },
            },
        });
    }

    // --------------------------------------------------
    // 8) BÔNUS RECURRENT (2 MESES)
    // --------------------------------------------------
    log("BONUS", "Gerando bônus RECURRENT (2 competências)");

    for (const competence of [competenceYM1, competenceYM2]) {
        for (let position = 1; position <= 8; position++) {
            const receiver = users[position - 1];

            const config = await prisma.referralPositionBonusConfig.findFirst({
                where: { position, type: BonusType.RECURRENT },
            });

            if (!config || config.amount <= 0) continue;

            const eventKey = `RECURRENT:${competence}:${group.id}:${position}`;

            await prisma.cashbackTransaction.create({
                data: {
                    userId: receiver.id,
                    type: TransactionType.EARNED,
                    source: TransactionSource.INDICATION,
                    amount: config.amount,
                    eventKey,
                    referralGroupId: group.id,
                    referralPosition: position,
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
                    balance: { increment: config.amount },
                },
            });
        }
    }

    // --------------------------------------------------
    // 9) USO DE CASHBACK (50%)
    // --------------------------------------------------
    log("DEBIT", "Testando uso de cashback (máx 50%)");

    const buyer = users[0];

    const walletBuyer = await prisma.cashbackWallet.findUnique({
        where: {
            userId_type: {
                userId: buyer.id,
                type: WalletType.INTERNAL,
            },
        },
    });

    assert(walletBuyer, "Wallet não encontrada");

    const maxAllowed = plan.price * 0.5;
    const usedAmount = Math.min(walletBuyer.balance, maxAllowed);

    await prisma.cashbackTransaction.create({
        data: {
            userId: buyer.id,
            type: TransactionType.USED,
            source: TransactionSource.SUBSCRIPTION_DEBIT,
            amount: usedAmount,
            eventKey: `DEBIT:${buyer.id}:${payment.id}`,
        },
    });

    await prisma.cashbackWallet.update({
        where: { id: walletBuyer.id },
        data: { balance: { decrement: usedAmount } },
    });

    // --------------------------------------------------
    // 10) RELATÓRIO FINAL
    // --------------------------------------------------
    log("REPORT", "=== RESULTADO FINAL ===");

    for (let i = 0; i < users.length; i++) {
        const user = users[i];

        const wallet = await prisma.cashbackWallet.findUnique({
            where: {
                userId_type: {
                    userId: user.id,
                    type: WalletType.INTERNAL,
                },
            },
        });

        const txs = await prisma.cashbackTransaction.count({
            where: { userId: user.id },
        });

        console.log(`\n--- POSIÇÃO ${i + 1} | ${user.name} ---`);
        console.log("Saldo final:", wallet?.balance ?? 0);
        console.log("Total de transações:", txs);
    }

    log("DONE", "=== SMOKE TEST MLM COMPLETO CONCLUÍDO COM SUCESSO ===");
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
