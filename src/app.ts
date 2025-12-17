import express from "express";
import cors from "cors";

import { errorHandler } from "./middlewares/ErrorHandler";
import { requestLogMiddleware } from "./middlewares/requestLogMiddleware";
import { configureHandlebars } from "./modules/docs";
import routes from "./routes";

const app = express();

// Necessário quando atrás de proxy reverso (NGINX / Cloudflare)
app.set("trust proxy", 1);

// ---------------------------------------------------
// CORS — Flutter Web / Ionic / Web
// ---------------------------------------------------

const allowedOrigins = [
    // Flutter Web (porta dinâmica)
    /^http:\/\/localhost:\d+$/,

    // Ionic
    "http://localhost:8100",

    // Web dev (se existir)
    "http://localhost:5173",

    // Produção
    "https://cashback.uauclube.com",
    "https://app-uauclube.com",
];

app.use(
    cors({
        origin(origin, callback) {
            // Mobile / Flutter nativo / Postman não enviam Origin
            if (!origin) {
                return callback(null, true);
            }

            const isAllowed = allowedOrigins.some((allowed) => {
                if (allowed instanceof RegExp) {
                    return allowed.test(origin);
                }
                return allowed === origin;
            });

            if (isAllowed) {
                return callback(null, true);
            }

            return callback(
                new Error(`CORS blocked for origin: ${origin}`)
            );
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Requested-With",
        ],
    }),
);

// ---------------------------------------------------
// IMPORTANTE: liberar preflight ANTES das rotas
// ---------------------------------------------------

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

// Error handler (sempre por último)
app.use(errorHandler);

export default app;
