/* scripts/cleanup-e2e-plans.js */
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Como usar:
 *  - Dry-run (recomendado primeiro):
 *      DRY_RUN=true node scripts/cleanup-e2e-plans.js
 *
 *  - Deletar de fato:
 *      node scripts/cleanup-e2e-plans.js
 *
 *  - Trocar o prefixo:
 *      PLAN_PREFIX="E2E Plano Pacote Mensal" node scripts/cleanup-e2e-plans.js
 */
const PLAN_PREFIX = (process.env.PLAN_PREFIX || "E2E Plano Pacote Mensal").trim();
const DRY_RUN = (process.env.DRY_RUN || "false").toLowerCase() === "true";

function logPlan(p) {
    return {
        id: p.id,
        name: p.name,
        periodicityType: p.periodicityType,
        isPackage: p.isPackage,
        createdAt: p.createdAt,
    };
}

(async function main() {
    console.log(`[cleanup-e2e-plans] PLAN_PREFIX="${PLAN_PREFIX}"`);
    console.log(`[cleanup-e2e-plans] DRY_RUN=${DRY_RUN}`);

    // 1) Buscar todos os planos criados pelo smoke
    const plans = await prisma.plan.findMany({
        where: {
            name: {
                startsWith: PLAN_PREFIX,
            },
        },
        orderBy: { id: "desc" },
        select: {
            id: true,
            name: true,
            periodicityType: true,
            isPackage: true,
            createdAt: true,
        },
    });

    if (!plans.length) {
        console.log("[cleanup-e2e-plans] Nenhum plano de teste encontrado para o prefixo informado.");
        return;
    }

    console.log(`[cleanup-e2e-plans] Encontrados ${plans.length} planos candidatos:`);
    plans.forEach((p) => console.log(" -", logPlan(p)));

    if (DRY_RUN) {
        console.log("[cleanup-e2e-plans] DRY_RUN=true => não vou apagar nada.");
        return;
    }

    // 2) Tentar deletar um por um
    //    - Primeiro tenta "desconectar" washServices (caso exista relação M:N e FK restritiva)
    //    - Depois deleta o plano
    let deleted = 0;
    let failed = 0;

    for (const p of plans) {
        try {
            // Se existir relação "washServices", este update pode funcionar.
            // Se não existir no schema atual, ele vai falhar e nós ignoramos.
            await prisma.plan
                .update({
                    where: { id: p.id },
                    data: {
                        washServices: { set: [] },
                    },
                })
                .catch(() => null);

            await prisma.plan.delete({ where: { id: p.id } });

            deleted++;
            console.log(`[cleanup-e2e-plans] OK delete planId=${p.id} name="${p.name}"`);
        } catch (e) {
            failed++;
            console.log(`[cleanup-e2e-plans] FAIL delete planId=${p.id} name="${p.name}"`);
            console.log(
                `[cleanup-e2e-plans] Motivo: ${e?.message || e}`
            );
            console.log(
                "[cleanup-e2e-plans] Observação: isso normalmente acontece quando existe FK (ex.: Subscription/Payment apontando para esse planId)."
            );
        }
    }

    console.log(`[cleanup-e2e-plans] Finalizado. deleted=${deleted} failed=${failed}`);
})()
    .catch((err) => {
        console.error("[cleanup-e2e-plans] Erro fatal:", err?.message || err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
