import "dotenv/config";
import { AsaasSyncService } from "./AsaasSyncService";
import prismaClient from "../config/dbConfig";

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("🚀 Iniciando sincronização Asaas → Postgres (Google Cloud)...");

  const service: AsaasSyncService = new AsaasSyncService();

  try {
    const resultado = await service.sincronizarTudo();
    // eslint-disable-next-line no-console
    console.log("✅ Resultado da sincronização:", JSON.stringify(resultado));
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.error("❌ Erro durante sincronização:", erro);
  } finally {
    await prismaClient.$disconnect();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  }
}

main().catch((erro: unknown) => {
  // eslint-disable-next-line no-console
  console.error("❌ Erro não tratado no main:", erro);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
