import app from "./app";
import { envConfig } from "./config/envConfig";

// CRÍTICO PARA CONTAINERS (Docker/AWS App Runner):
// Prioriza process.env.PORT (injetado pelo App Runner) sobre envConfig.PORT
// O App Runner injeta PORT=8080 por padrão, mas pode ser configurado
const port = Number(process.env.PORT) || Number(envConfig.PORT) || 3000;

// CRÍTICO PARA CONTAINERS: Host deve ser 0.0.0.0 para ser acessível externamente
// Se não especificar, Express escuta apenas em localhost (127.0.0.1)
// Isso impede que o App Runner acesse a aplicação
const host = process.env.HOST || "0.0.0.0";

// Tratamento de erros não capturados para evitar que o servidor caia
process.on("unhandledRejection", (reason, promise) => {
	console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
	console.error("[Server] Uncaught Exception:", error);
	// Não encerra o processo imediatamente - permite que o App Runner tente recuperar
});

// Logs detalhados antes de iniciar
console.log("[Server] Starting server...");
console.log("[Server] Environment:", process.env.NODE_ENV || "development");
console.log("[Server] Port:", port);
console.log("[Server] Host:", host);
console.log("[Server] Database URL configured:", process.env.DATABASE_URL ? "Yes" : "No");

// CRÍTICO: Escuta em 0.0.0.0 para ser acessível em containers Docker
app.listen(port, host, () => {
	console.log(`[Server] ✅ Server is running on http://${host}:${port}`);
	console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
	console.log(`[Server] Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`);
	
	// Health check endpoint básico (já existe em routes.ts, mas logamos aqui)
	console.log(`[Server] Health check available at: http://${host}:${port}/health`);
}).on("error", (error: NodeJS.ErrnoException) => {
	console.error("[Server] ❌ Failed to start server:", error);
	console.error("[Server] Error details:", {
		code: error.code,
		message: error.message,
		port,
		host,
	});
	
	if (error.code === "EADDRINUSE") {
		console.error(`[Server] Port ${port} is already in use`);
		console.error(`[Server] Please stop the process using this port or change the PORT environment variable`);
	}
	
	process.exit(1);
});
