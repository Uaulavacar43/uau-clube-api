import express, { Router } from "express";
import path from "path";
import prisma from "./config/dbConfig";

import authRoutes from "./modules/auth/routes";
import couponRoutes from "./modules/coupon/routes";
import dailyWashRoutes from "./modules/dailyWash/routes";
import dashboardRoutes from "./modules/dashboard/routes";
import { docsRoutes } from "./modules/docs";
import { fileUploadRoutes } from "./modules/fileUpload";
import notifications from "./modules/notification/routes";
import paymentRoutes from "./modules/payment";
import plans from "./modules/plan/routes";
import subscription from "./modules/subscription/routes";
import users from "./modules/userAdmin/routes";
import userCarRoutes from "./modules/userCar/routes";
import userProfile from "./modules/userProfile/routes";
import washServiceRoutes from "./modules/wash-service/routes";
import WashLocation from "./modules/washLocation/routes";

// Asaas (sincronização clientes + pagamentos)
import asaasRoutes from "./assas/asaas.routes";
import welcomeBonusRoutes from "./modules/welcome-bonus";

const routes = Router();

// Health check route - para verificar se a API está funcionando
// CRÍTICO PARA AWS APP RUNNER: Este endpoint é usado para health checks
// Retorna 200 mesmo se o banco estiver desconectado (para permitir inicialização)
// O App Runner precisa que o servidor responda 200 para considerar o deploy bem-sucedido
routes.get("/health", async (_req, res) => {
	try {
		// Verifica conexão com o banco de dados com timeout
		await Promise.race([
			prisma.$queryRaw`SELECT 1`,
			new Promise((_, reject) => 
				setTimeout(() => reject(new Error("Database health check timeout")), 5000)
			)
		]);
		
		res.status(200).json({
			status: "ok",
			timestamp: new Date().toISOString(),
			environment: process.env.NODE_ENV || "development",
			database: "connected",
			server: "running",
		});
	} catch (error) {
		// IMPORTANTE: Retorna 200 mesmo com erro de banco para permitir inicialização
		// O App Runner precisa que o servidor responda para considerar o deploy bem-sucedido
		// O banco pode estar temporariamente indisponível durante migrações ou restarts
		console.warn("[Health Check] ⚠️ Database health check failed (non-critical):", error instanceof Error ? error.message : "Unknown error");
		
		res.status(200).json({
			status: "ok",
			timestamp: new Date().toISOString(),
			environment: process.env.NODE_ENV || "development",
			database: "disconnected",
			server: "running",
			warning: "Database connection check failed, but server is operational",
		});
	}
});

// Arquivos estáticos de upload
routes.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// Rotas da aplicação
routes.use("/auth", authRoutes);
routes.use("/dashboard", dashboardRoutes);
routes.use("/wash-services", washServiceRoutes);
routes.use("/user-car", userCarRoutes);
routes.use("/subscription", subscription);
routes.use("/daily-wash", dailyWashRoutes);
routes.use("/users", users);
routes.use("/wash-location", WashLocation);
routes.use("/user-profile", userProfile);
routes.use("/payment", paymentRoutes);
routes.use("/notifications", notifications);
routes.use("/plans", plans);
routes.use("/file-upload", fileUploadRoutes);
routes.use("/docs", docsRoutes);
routes.use("/coupons", couponRoutes);

// Bônus de boas-vindas
routes.use("/welcome-bonus", welcomeBonusRoutes);

// Rotas de integração/sincronização com Asaas
routes.use("/asaas", asaasRoutes);

export default routes;
