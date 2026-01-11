import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

// Garante que as variáveis de ambiente estão carregadas
dotenv.config();

// Configuração do PrismaClient otimizada para produção
// Em produção, usa configurações mais robustas para lidar com Cloud SQL
const isProduction = process.env.NODE_ENV === "production";

// Verifica se DATABASE_URL está configurada
if (!process.env.DATABASE_URL) {
	console.error("[dbConfig] DATABASE_URL não está configurada!");
}

const prisma = new PrismaClient({
	log: isProduction ? ["error", "warn"] : ["query", "error", "warn"],
	// O Prisma gerencia connection pooling automaticamente
	// Não precisa configurar datasources explicitamente - lê de DATABASE_URL
});

// Configuração de connection pooling e timeouts
// Isso ajuda a lidar com problemas de conexão após restarts do Cloud SQL
// Não bloqueia a inicialização se a conexão falhar - permite retry posterior
// CRÍTICO: Não bloqueia a inicialização do servidor para permitir health checks
console.log("[dbConfig] Attempting to connect to database...");
prisma.$connect()
	.then(() => {
		console.log("[dbConfig] ✅ Conexão com o banco de dados estabelecida com sucesso");
		console.log("[dbConfig] Database URL:", process.env.DATABASE_URL ? "Configured" : "Not configured");
	})
	.catch((error) => {
		console.error("[dbConfig] ⚠️ Failed to connect to database on startup:", {
			message: error.message,
			code: error.code,
			meta: error.meta,
		});
		console.error("[dbConfig] The application will continue, but database operations may fail.");
		console.error("[dbConfig] This is expected behavior after Cloud SQL restarts - connections will retry automatically.");
		console.error("[dbConfig] Health check endpoint will still be available.");
	});

// Graceful shutdown - fecha conexões ao encerrar
process.on("beforeExit", async () => {
	await prisma.$disconnect();
});

export default prisma;
