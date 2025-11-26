// src/asaas/sync-asaas.ts

import "dotenv/config";
import { AsaasSyncService } from "./AsaasSyncService";
import prismaClient from "../config/dbConfig";
import { envConfig } from "../config/envConfig";

type SyncMode = "clientes" | "pagamentos" | "tudo";

function getSyncModeFromArgs(): SyncMode {
    const argMode: string | undefined = process.argv[2];

    if (!argMode) {
        return "tudo";
    }

    const normalized: string = argMode.toLowerCase();

    if (normalized === "clientes") {
        return "clientes";
    }

    if (normalized === "pagamentos") {
        return "pagamentos";
    }

    return "tudo";
}

async function main(): Promise<void> {
    console.clear();

    const mode: SyncMode = getSyncModeFromArgs();

    console.log("###########################################################");
    console.log("🚀 INICIANDO SCRIPT DE SINCRONIZAÇÃO MASSIVA (ASAAS -> DB)");
    console.log(`➡️  Ambiente: ${envConfig.NODE_ENV}`);
    console.log("➡️  Modo base: Varredura Completa (Paginação Infinita + Delay)");
    console.log(
        `➡️  Alvo: ${
            mode === "tudo"
                ? "Clientes + Pagamentos"
                : mode === "clientes"
                    ? "Apenas Clientes"
                    : "Apenas Pagamentos"
        }`,
    );
    console.log("###########################################################\n");

    console.log("🔌 Conectando ao banco de dados...");

    const service: AsaasSyncService = new AsaasSyncService();

    try {
        const tempoInicio: number = Date.now();

        let resultadoClientes:
            | {
            totalProcessados: number;
            totalCriados: number;
            totalAtualizados: number;
        }
            | null = null;

        let resultadoPagamentos:
            | {
            totalProcessados: number;
            totalCriados: number;
            totalIgnorados: number;
        }
            | null = null;

        if (mode === "tudo") {
            const resultadoCompleto = await service.sincronizarTudo();
            resultadoClientes = resultadoCompleto.clientes;
            resultadoPagamentos = resultadoCompleto.pagamentos;
        } else if (mode === "clientes") {
            console.log("👥 Iniciando sincronização APENAS de CLIENTES...");
            resultadoClientes = await service.sincronizarClientes();
        } else if (mode === "pagamentos") {
            console.log("💳 Iniciando sincronização APENAS de PAGAMENTOS...");
            // Importante: garantir que o cache de clientes esteja preenchido
            // Caso ainda não tenha rodado clientes neste processo, podemos
            // opcionalmente puxar todos os clientes primeiro.
            console.log(
                "👥 Pré-carregando clientes do ASAAS para vincular pagamentos...",
            );
            await service.sincronizarClientes();
            resultadoPagamentos = await service.sincronizarPagamentos();
        }

        const tempoFim: number = Date.now();
        const duracaoSegundos: string = (
            (tempoFim - tempoInicio) /
            1000
        ).toFixed(2);

        console.log("\n✅ Sincronização concluída com sucesso!");
        console.log(`⏱️ Tempo total de execução: ${duracaoSegundos}s`);
        console.log("-----------------------------------------------------------");

        if (resultadoClientes !== null) {
            console.log(
                "👥 RELATÓRIO DE CLIENTES:" +
                `\n   - Total Processados (API): ${resultadoClientes.totalProcessados}` +
                `\n   - Novos Usuários Criados:  ${resultadoClientes.totalCriados}` +
                `\n   - Usuários Atualizados:    ${resultadoClientes.totalAtualizados}`,
            );
        }

        if (resultadoPagamentos !== null) {
            console.log(
                "\n💳 RELATÓRIO DE PAGAMENTOS:" +
                `\n   - Total Processados (API): ${resultadoPagamentos.totalProcessados}` +
                `\n   - Novos Pagamentos Criados:${resultadoPagamentos.totalCriados}` +
                `\n   - Ignorados (Já existem):  ${resultadoPagamentos.totalIgnorados}`,
            );
        }

        console.log("-----------------------------------------------------------");
        console.log("📦 Resultado Bruto (JSON):");

        const resultadoBruto = {
            mode,
            clientes: resultadoClientes,
            pagamentos: resultadoPagamentos,
        };

        console.log(JSON.stringify(resultadoBruto, null, 2));
    } catch (erro) {
        console.error("\n❌ ERRO FATAL DURANTE A SINCRONIZAÇÃO:");
        console.error(
            "   O script foi interrompido devido a uma exceção não tratada.",
        );
        console.error(erro);
        throw erro;
    } finally {
        console.log("\n🔌 Desconectando do banco de dados...");
        await prismaClient.$disconnect();
    }
}

main()
    .then(() => {
        console.log("\n🏁 Script finalizado corretamente (Exit Code 0).");
        // eslint-disable-next-line no-process-exit
        process.exit(0);
    })
    .catch((erro: unknown) => {
        console.error(
            "\n❌ Ocorreu um erro não tratado no bloco main:",
            erro,
        );
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    });
