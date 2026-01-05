// src/app.ts
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";

import swaggerSpec from "./config/swagger";
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
    /^http:\/\/localhost:\d+$/, // Flutter Web dev
    "http://localhost:8100", // Ionic
    "http://localhost:5173", // Vite (se existir)
    /^https:\/\/.*\.web\.app$/, // Firebase Hosting
    "https://cashback.uauclube.com",
    "https://app.uauclube.com",
];

app.use(
    cors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);

            const allowed = allowedOrigins.some((o) =>
                o instanceof RegExp ? o.test(origin) : o === origin,
            );

            return callback(null, allowed);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    }),
);

app.options("*", cors());

// ---------------------------------------------------
// Middlewares globais
// ---------------------------------------------------

app.use(requestLogMiddleware);
app.use(express.json());

// ---------------------------------------------------
// Swagger (NÃO usa /docs pra não conflitar com handlebars)
// ---------------------------------------------------

// Spec JSON do OpenAPI
app.get("/swagger.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(swaggerSpec);
});

// UI do Swagger (carrega o JSON via URL, mais robusto)
app.use(
    "/swagger",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
        explorer: true,
        swaggerOptions: {
            url: "/swagger.json",
            persistAuthorization: true,
            displayRequestDuration: true,
        },
    }),
);

// ---------------------------------------------------
// Handlebars (teu /docs markdown continua funcionando)
// ---------------------------------------------------

configureHandlebars(app);

// ---------------------------------------------------
// Rotas
// ---------------------------------------------------

app.use("/", routes);

// ---------------------------------------------------
// Error handler (por último)
// ---------------------------------------------------

app.use(errorHandler);

export default app;
