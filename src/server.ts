import app from "./app";
import { envConfig } from "./config/envConfig";

// Asegúrate de convertir el puerto a un número válido o usar un valor predeterminado.
const port = Number(envConfig.PORT) || 3000;

// Tratamento de erros não capturados para evitar que o servidor caia
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
	console.error("Uncaught Exception:", error);
	// Não encerra o processo imediatamente - permite que o Cloud Run tente recuperar
});

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
	console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
	console.log(`Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`);
}).on("error", (error: NodeJS.ErrnoException) => {
	console.error("Failed to start server:", error);
	if (error.code === "EADDRINUSE") {
		console.error(`Port ${port} is already in use`);
	}
	process.exit(1);
});
