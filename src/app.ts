import express from "express";
import cors from "cors";

import { errorHandler } from "./middlewares/ErrorHandler";
import { requestLogMiddleware } from "./middlewares/requestLogMiddleware";
import { configureHandlebars } from "./modules/docs";
import routes from "./routes";

const app = express();

app.set("trust proxy", 1);

// ---------------------------------------------------
// CORS — DEFINITIVO
// ---------------------------------------------------

const allowedOrigins = [
    /^http:\/\/localhost:\d+$/,        // Flutter Web dev
    "http://localhost:8100",           // Ionic
    "http://localhost:5173",           // Vite (se existir)
    /^https:\/\/.*\.web\.app$/,        // Firebase Hosting
    "https://cashback.uauclube.com",
    "https://app.uauclube.com",
];

app.use(
    cors({
        origin(origin, callback) {
            // Mobile / Postman / server-to-server
            if (!origin) return callback(null, true);

            const allowed = allowedOrigins.some((o) =>
                o instanceof RegExp ? o.test(origin) : o === origin
            );

            // ⚠️ NÃO lance erro aqui
            return callback(null, allowed);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Requested-With",
        ],
    })
);

// ✅ Preflight SEMPRE liberado
app.options("*", cors());

// ---------------------------------------------------
// Middlewares globais
// ---------------------------------------------------

app.use(requestLogMiddleware);
app.use(express.json());

// Docs
configureHandlebars(app);

// Rotas
app.use("/", routes);

// Error handler (por último)
app.use(errorHandler);

export default app;
