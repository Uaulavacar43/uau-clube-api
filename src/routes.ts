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

// ✅ Referrals (Fase 1)
import referralsRoutes from "./modules/referrals/routes";

// ✅ Cashback (Fase 4)
import cashbackRoutes from "./modules/cashback/routes";
import { adminCarRoutes } from "./modules/adminCar";

const routes = Router();

// Arquivos estáticos de upload
routes.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

/**
 * ✅ REDIRECT PÚBLICO DE INDICAÇÃO (ARRANJO TEMPORÁRIO)
 *
 * Link: https://uauapp.com/r/ABC123
 *
 * - Android: manda pra Play Store com referrer=ref=ABC123 (pode recuperar “às vezes” via Install Referrer no app)
 * - iOS: manda pra App Store (sem deep link, normalmente perde o código após instalar)
 * - Desktop: manda pro site (cadastro) com ?ref=ABC123
 *
 * Observação importante:
 * - Isso NÃO abre o app automaticamente sem Deep Link/Universal Link.
 * - Serve só pra levar o usuário pra loja e “tentar” preservar o ref (principalmente Android).
 */
routes.get("/r/:code", (req, res) => {
    const code = String(req.params.code ?? "").trim();

    if (!code) {
        return res.redirect(302, "https://uauapp.com");
    }

    const ua = String(req.headers["user-agent"] ?? "").toLowerCase();

    const isAndroid = ua.includes("android");
    const isIOS =
        ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod");

    // ✅ Android: Play Store com referrer
    // Se você setar env PLAY_STORE_URL, ele usa.
    // Ex: https://play.google.com/store/apps/details?id=com.seuapp
    const playStoreBase =
        (process.env.PLAY_STORE_URL ?? "").trim() ||
        "https://play.google.com/store/apps/details?id=SEU.PACKAGE.NAME";

    const playReferrer = encodeURIComponent(`ref=${code}`);
    const playStoreUrl = `${playStoreBase}${playStoreBase.includes("?") ? "&" : "?"}referrer=${playReferrer}`;

    // ✅ iOS: App Store (sem deep link, normalmente perde ref)
    // Se você setar env APP_STORE_URL, ele usa.
    // Ex: https://apps.apple.com/app/id123456789
    const appStoreUrl =
        (process.env.APP_STORE_URL ?? "").trim() ||
        "https://apps.apple.com/app/idSEU_APP_ID";

    // ✅ fallback web
    const webFallbackBase =
        (process.env.WEB_FALLBACK_URL ?? "").trim() ||
        "https://uauapp.com/cadastro";

    const webFallbackUrl = `${webFallbackBase}${webFallbackBase.includes("?") ? "&" : "?"}ref=${encodeURIComponent(code)}`;

    if (isAndroid) {
        return res.redirect(302, playStoreUrl);
    }

    if (isIOS) {
        return res.redirect(302, appStoreUrl);
    }

    return res.redirect(302, webFallbackUrl);
});

// Rotas da aplicação
routes.use("/auth", authRoutes);
routes.use("/dashboard", dashboardRoutes);
routes.use("/wash-services", washServiceRoutes);

routes.use("/user-car", userCarRoutes);

// ✅ Admin endpoints de carro
routes.use("/admin-car", adminCarRoutes);

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

// ✅ Monta /referrals/*
routes.use("/referrals", referralsRoutes);

// ✅ Monta /cashback/*
routes.use("/cashback", cashbackRoutes);

// Rotas de integração/sincronização com Asaas
routes.use("/asaas", asaasRoutes);

export default routes;
