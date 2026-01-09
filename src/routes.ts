import express, { Router } from "express";
import path from "path";

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

const routes = Router();

// Health check route - para verificar se a API está funcionando
routes.get("/health", (_req, res) => {
	res.status(200).json({
		status: "ok",
		timestamp: new Date().toISOString(),
		environment: process.env.NODE_ENV || "development",
	});
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

// Rotas de integração/sincronização com Asaas
routes.use("/asaas", asaasRoutes);

export default routes;
