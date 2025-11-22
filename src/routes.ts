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
import subscription from "./modules/subscription/routes"; // Importa las rutas del módulo subscription
import users from "./modules/userAdmin/routes";
import userCarRoutes from "./modules/userCar/routes"; // Importa las rutas del módulo userCar
import userProfile from "./modules/userProfile/routes";
import washServiceRoutes from "./modules/wash-service/routes";
import WashLocation from "./modules/washLocation/routes";

const routes = Router();
routes.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

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

export default routes;
