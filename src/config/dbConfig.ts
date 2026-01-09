import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
	log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
	datasources: {
		db: {
			url: process.env.DATABASE_URL,
		},
	},
});

// Configuração de connection pooling e timeouts
// Isso ajuda a lidar com problemas de conexão após restarts do Cloud SQL
// Não bloqueia a inicialização se a conexão falhar - permite retry posterior
prisma.$connect().catch((error) => {
	console.error("Failed to connect to database on startup:", error);
	console.error("The application will continue, but database operations may fail.");
	console.error("This is expected behavior after Cloud SQL restarts - connections will retry automatically.");
});

// Graceful shutdown - fecha conexões ao encerrar
process.on("beforeExit", async () => {
	await prisma.$disconnect();
});

export default prisma;
