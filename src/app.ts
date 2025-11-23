// src/app.ts

import cors from "cors";
import express from "express";

import { errorHandler } from "./middlewares/ErrorHandler";
import { requestLogMiddleware } from "./middlewares/requestLogMiddleware";
import { configureHandlebars } from "./modules/docs";
import routes from "./routes";

const app = express();

// Necessário quando a aplicação está atrás de proxy reverso (Cloud Run, ingress, etc.)
app.set("trust proxy", 1);

// Configuração de CORS (aqui liberando tudo; ajuste se quiser restringir)
app.use(
    cors({
        origin(_requestOrigin, callback) {
            callback(null, true);
        },
    }),
);

// Middleware de log de request
app.use(requestLogMiddleware);

// Parser de JSON
app.use(express.json());

// Configuração do Handlebars para documentação
configureHandlebars(app);

// Rotas principais
app.use("/", routes);

// Middleware global de tratamento de erros
app.use(errorHandler);

export default app;
