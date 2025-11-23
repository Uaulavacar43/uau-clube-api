import "dotenv/config";
import { AsaasSyncService } from "./AsaasSyncService";
import prismaClient from "../config/dbConfig";
import { envConfig } from "../config/envConfig";

async function main(): Promise<void> {
    // Limpa o console para facilitar a leitura do início do processo
    console.clear();

    console.log("###########################################################");
    console.log("🚀 INICIANDO SCRIPT DE SINCRONIZAÇÃO MASSIVA (ASAAS -> DB)");
    console.log(`➡️  Ambiente: ${envConfig.NODE_ENV}`);
    console.log("➡️  Modo: Varredura Completa (Paginação Infinita + Delay)");
    console.log("###########################################################\n");

    console.log("🔌 Conectando ao banco de dados...");

    // Instancia o serviço que contém a lógica "trator" (com delay e while true)
    const service: AsaasSyncService = new AsaasSyncService();

    try {
        const tempoInicio = Date.now();

        // Chama o método mestre que orquestra clientes e depois pagamentos
        const resultado = await service.sincronizarTudo();

        const tempoFim = Date.now();
        const duracaoSegundos = ((tempoFim - tempoInicio) / 1000).toFixed(2);

        console.log("\n✅ Sincronização concluída com sucesso!");
        console.log(`⏱️ Tempo total de execução: ${duracaoSegundos}s`);
        console.log("-----------------------------------------------------------");

        // Exibe relatório de Clientes
        if (resultado.clientes) {
            console.log(
                `👥 RELATÓRIO DE CLIENTES:` +
                `\n   - Total Processados (API): ${resultado.clientes.totalProcessados}` +
                `\n   - Novos Usuários Criados:  ${resultado.clientes.totalCriados}` +
                `\n   - Usuários Atualizados:    ${resultado.clientes.totalAtualizados}`
            );
        }

        // Exibe relatório de Pagamentos
        if (resultado.pagamentos) {
            console.log(
                `\n💳 RELATÓRIO DE PAGAMENTOS:` +
                `\n   - Total Processados (API): ${resultado.pagamentos.totalProcessados}` +
                `\n   - Novos Pagamentos Criados:${resultado.pagamentos.totalCriados}` +
                `\n   - Ignorados (Já existem):  ${resultado.pagamentos.totalIgnorados}`
            );
        }

        console.log("-----------------------------------------------------------");
        console.log("📦 Resultado Bruto (JSON):");
        console.log(JSON.stringify(resultado, null, 2));

    } catch (erro) {
        console.error("\n❌ ERRO FATAL DURANTE A SINCRONIZAÇÃO:");
        console.error("   O script foi interrompido devido a uma exceção não tratada.");
        console.error(erro);
        throw erro; // Relança para cair no catch do processo principal
    } finally {
        console.log("\n🔌 Desconectando do banco de dados...");
        await prismaClient.$disconnect();
    }
}

// Execução do ponto de entrada
main()
    .then(() => {
        console.log("\n🏁 Script finalizado corretamente (Exit Code 0).");
        // eslint-disable-next-line no-process-exit
        process.exit(0);
    })
    .catch((erro: unknown) => {
        console.error("\n❌ Ocorreu um erro não tratado no bloco main:", erro);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    });