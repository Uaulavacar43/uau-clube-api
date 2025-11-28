import {
    PaymentStatus,
    PeriodicityType,
    PrismaClient,
    PurchaseStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// =========================================================================
// CONFIGURAÇÕES GERAIS
// =========================================================================

const ADMIN_USER_ID: number = 1;

// Serviços inclusos em TODOS os planos
const PLAN_SERVICES_LIST: string[] = [
    'Pré-lavagem',
    'Shampoo ativo',
    'Lavagem',
    'Secagem',
    'Cera líquida',
    'Acabamentos manuais',
    'Aspiração',
    'Pretinho no pneu',
    'Cheirinho',
];

const PLAN_SERVICES_TEXT: string = PLAN_SERVICES_LIST.join(', ');

// =========================================================================
// 1. MAPEAMENTO MANUAL CRÍTICO POR PREÇO/TIPO
//    → APENAS O PLANO ATIVO (MENSAL) + SERVIÇOS AVULSOS
// =========================================================================

const CATALOG_MAPPING_PRICES: {
    plans: {
        [key: string]: {
            price: number;
            duration: number;
            periodicityType: PeriodicityType;
            maxInstallments: number;
            description: string;
        };
    };
    services: {
        [key: string]: {
            price: number;
            imageUrl: string;
        };
    };
} = {
    // ---------------------------------------------------------------------
    // PLANOS (SOMENTE O MENSAL ATIVO - REMOVEMOS O TRIMESTRAL E ANUAL)
    // ---------------------------------------------------------------------
    plans: {
        // Topzeira Mensal (recorrente, sem parcelamento)
        'Topzeira Mensal': {
            price: 139.9,
            duration: 30,
            periodicityType: PeriodicityType.MONTH,
            maxInstallments: 1, // recorrente, 1 cobrança por mês (sem parcelar)
            description: `Topzeira Mensal ilimitado (R$139,90). Cobrança recorrente mensal, sem parcelamento. Inclui: ${PLAN_SERVICES_TEXT}.`,
        },
    },

    // ---------------------------------------------------------------------
    // SERVIÇOS AVULSOS (MANTIDOS PARA MAPEAMENTO DA FASE 3)
    // ---------------------------------------------------------------------
    services: {
        'Lavagem Simples - Avulsa': {
            price: 30.0,
            imageUrl: 'default_wash_simple.png',
        },
        'Lavagem Completa Especial': {
            price: 50.0,
            imageUrl: 'default_wash_complete.png',
        },
        'Higienizacao Interna - Unica': {
            price: 150.0,
            imageUrl: 'default_higienizacao.png',
        },

        // Outros serviços avulsos identificados no log:
        'Serviço Avulso R$1000 (Verificar)': {
            price: 1000.0,
            imageUrl: 'default_service.png',
        },
        'Serviço Avulso R$65 (Verificar)': {
            price: 65.0,
            imageUrl: 'default_service.png',
        },
        'Serviço Avulso R$35 (Verificar)': {
            price: 35.0,
            imageUrl: 'default_service.png',
        },
        'Serviço Avulso R$21.23 (Verificar)': {
            price: 21.23,
            imageUrl: 'default_service.png',
        },
        'Serviço Avulso R$20 (Verificar)': {
            price: 20.0,
            imageUrl: 'default_service.png',
        },
        'Serviço Avulso R$15 (Verificar)': {
            price: 15.0,
            imageUrl: 'default_service.png',
        },
    },
};

const NEW_PLAN_IDS: Record<string, number> = {};
const NEW_SERVICE_IDS: Record<string, number> = {};
const PRICE_TO_PLAN_ID: Record<number, number> = {};
const PRICE_TO_SERVICE_ID: Record<number, number> = {};

// =========================================================================
/**
 * FASE 1: CRIAÇÃO E LIMPEZA DO CATÁLOGO DE PRODUTOS
 * - Garante catálogos de planos com parcelamento (maxInstallments).
 * - Mantém apenas o plano Mensal.
 * - Cria/atualiza serviços avulsos.
 */
// =========================================================================

async function createCatalog(): Promise<void> {
    console.log('--- FASE 1: Criando Planos e Serviços no Catálogo ---');

    const currentPlanNames: string[] = Object.keys(CATALOG_MAPPING_PRICES.plans);

    // 1. CRIA/ATUALIZA OS PLANOS ATIVOS
    for (const [planName, data] of Object.entries(
        CATALOG_MAPPING_PRICES.plans,
    )) {
        let plan = await prisma.plan.findUnique({ where: { name: planName } });

        if (!plan) {
            // OBS: O campo isActive não é fornecido aqui, o que está correto
            // já que ele não existe no schema.
            plan = await prisma.plan.create({
                data: {
                    name: planName,
                    price: data.price,
                    duration: data.duration,
                    periodicityType: data.periodicityType,
                    description: data.description,
                    maxInstallments: data.maxInstallments,
                },
            });
        } else {
            plan = await prisma.plan.update({
                where: { id: plan.id },
                data: {
                    price: data.price,
                    duration: data.duration,
                    periodicityType: data.periodicityType,
                    description: data.description,
                    maxInstallments: data.maxInstallments,
                },
            });
        }

        NEW_PLAN_IDS[planName] = plan.id;

        // plan.price é Decimal → converte para number para usar como chave
        const numericPrice: number = Number(plan.price);
        PRICE_TO_PLAN_ID[numericPrice] = plan.id;

        console.log(
            `✅ Plano criado/encontrado: ${plan.name} (ID: ${
                plan.id
            }, Preço: R$${numericPrice.toFixed(2)}, Máx. Parcelas: ${
                plan.maxInstallments ?? 0
            })`,
        );
    }

    // 2. EXCLUI PLANOS INEXISTENTES
    // Isso irá excluir o Trimestral e o Anual do BD, já que eles
    // não estão mais na lista de planos ativos (currentPlanNames).
    const allExistingPlans = await prisma.plan.findMany({
        select: { id: true, name: true },
        where: { name: { notIn: currentPlanNames } },
    });

    if (allExistingPlans.length > 0) {
        const idsToDelete: number[] = allExistingPlans.map((p) => p.id);

        try {
            const deleteResult = await prisma.plan.deleteMany({
                where: { id: { in: idsToDelete } },
            });

            console.log('\n--- Limpeza de Catálogo de Planos ---');
            console.log(`🗑️ Excluídos ${deleteResult.count} Planos Inativos:`);
            allExistingPlans.forEach((p) =>
                console.log(`   - ${p.name} (ID: ${p.id})`),
            );
            console.log('--------------------------------------');
        } catch (error) {
            console.error(
                '\n⚠️ Erro ao limpar planos inativos. Possível vínculo com assinaturas/pagamentos.',
            );
            console.error(error);
        }
    }

    // 3. CRIA/ATUALIZA SERVIÇOS AVULSOS
    for (const [serviceName, data] of Object.entries(
        CATALOG_MAPPING_PRICES.services,
    )) {
        let service = await prisma.washService.findUnique({
            where: { name: serviceName },
        });

        if (!service) {
            service = await prisma.washService.create({
                data: {
                    name: serviceName,
                    price: data.price,
                    imageUrl: data.imageUrl,
                    adminId: ADMIN_USER_ID,
                    isAvailable: true,
                    isPublished: true,
                },
            });
        } else {
            service = await prisma.washService.update({
                where: { id: service.id },
                data: {
                    price: data.price,
                    imageUrl: data.imageUrl,
                },
            });
        }

        NEW_SERVICE_IDS[serviceName] = service.id;

        // service.price também pode ser Decimal → converte para number
        const numericServicePrice: number = Number(service.price);
        PRICE_TO_SERVICE_ID[numericServicePrice] = service.id;

        console.log(
            `✅ Serviço criado/encontrado: ${service.name} (ID: ${
                service.id
            }, Preço: R$${numericServicePrice.toFixed(2)})`,
        );
    }
}

// =========================================================================
/**
 * FASE 2: CORREÇÃO DE ASSINATURAS E PAGAMENTOS DE PLANOS
 * - Amarra subscriptions antigas aos novos planos.
 * - Mapeia pagamentos antigos para planId com base no valor.
 */
// =========================================================================

async function updateSubscriptionsAndPlanPayments(): Promise<void> {
    console.log(
        '\n--- FASE 2: Corrigindo Subscriptions e Payments de Planos ---',
    );

    // --- FASE 2.1: Corrigir Subscriptions (PlanType) ---
    for (const [planName, newId] of Object.entries(NEW_PLAN_IDS)) {
        const result = await prisma.subscription.updateMany({
            where: {
                planType: planName,
                planId: null,
            },
            data: { planId: newId },
        });
        console.log(
            `✅ Atualizadas ${result.count} assinaturas para o Plano ID ${newId} (${planName}).`,
        );
    }

    // --- FASE 2.2: Corrigir Pagamentos que DEVEM ser de Planos (por preço) ---
    let paymentsUpdatedToPlan = 0;

    for (const [priceStr, planId] of Object.entries(PRICE_TO_PLAN_ID)) {
        const priceFloat: number = parseFloat(priceStr);

        const result = await prisma.payment.updateMany({
            where: {
                planId: null,
                amount: priceFloat,
            },
            data: {
                planId,
            },
        });

        paymentsUpdatedToPlan += result.count;

        console.log(
            `✅ Corrigidos ${result.count} pagamentos (sem Plan ID) para o Plano ID ${planId} (Preço: R$${priceFloat.toFixed(
                2,
            )}).`,
        );
    }

    console.log(
        `\n**Total de Pagamentos mapeados para Planos:** ${paymentsUpdatedToPlan}`,
    );
}

// =========================================================================
/**
 * FASE 3: CORREÇÃO DE PAGAMENTOS AVULSOS
 * - Cria IndividualServicePurchase para pagamentos que não são de plano.
 */
// =========================================================================

async function createPurchasesAndFixServicePayments(): Promise<void> {
    console.log(
        '\n--- FASE 3: Criando IndividualServicePurchase para Serviços Avulsos ---',
    );

    const soloPayments = await prisma.payment.findMany({
        where: {
            paymentIdAsaas: { not: null },
            planId: null,
        },
    });

    let purchasesCreated = 0;
    let paymentsNotFound = 0;

    for (const payment of soloPayments) {
        const amountNumeric: number = Number(payment.amount);
        const washServiceId: number | undefined =
            PRICE_TO_SERVICE_ID[amountNumeric];

        if (washServiceId !== undefined) {
            await prisma.individualServicePurchase.upsert({
                where: { paymentId: payment.id },
                update: {
                    washServiceId,
                },
                create: {
                    userId: payment.userId,
                    paymentId: payment.id,
                    washServiceId,
                    purchaseDate: payment.paymentDate,
                    status:
                        payment.status === PaymentStatus.PAID
                            ? PurchaseStatus.COMPLETED
                            : (PurchaseStatus[
                                payment.status as keyof typeof PurchaseStatus
                                ] ?? PurchaseStatus.PENDING),
                },
            });
            purchasesCreated++;
        } else {
            console.warn(
                `❌ Aviso: Pagamento ${payment.id} de R$${amountNumeric.toFixed(
                    2,
                )} NÃO PÔDE ser mapeado para um Serviço Avulso. (VERIFICAR MANUALMENTE)`,
            );
            paymentsNotFound++;
        }
    }

    console.log(
        `\n🎉 Total de IndividualServicePurchase criados/atualizados: ${purchasesCreated}`,
    );
    console.log(
        `⚠️ Total de Pagamentos Avulsos NÃO mapeados (Restante): ${paymentsNotFound}`,
    );
}

// =========================================================================
// EXECUÇÃO PRINCIPAL
// =========================================================================

async function main(): Promise<void> {
    try {
        await createCatalog();
        await updateSubscriptionsAndPlanPayments();
        await createPurchasesAndFixServicePayments();

        console.log('\n=======================================================');
        console.log('MIGRAÇÃO DE DADOS DO ASAAS CONCLUÍDA COM SUCESSO!');
        console.log('=======================================================');
    } catch (error) {
        console.error('\n❌ Erro crítico na execução principal:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();