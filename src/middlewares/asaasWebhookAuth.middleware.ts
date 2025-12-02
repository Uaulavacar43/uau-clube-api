// src/middlewares/asaasWebhookAuthMiddleware.ts

import type { Request, Response, NextFunction } from "express";

const HARDCODED_ASAAS_WEBHOOK_TOKEN = "123123";

export function asaasWebhookAuthMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
): void {
    const headerValue =
        request.headers["asaas-access-token"] ??
        request.headers["ASAAS-ACCESS-TOKEN"];

    const tokenRecebido =
        typeof headerValue === "string"
            ? headerValue
            : Array.isArray(headerValue)
                ? headerValue[0]
                : undefined;

    if (!tokenRecebido) {
        console.warn(
            "[asaasWebhookAuthMiddleware] Header 'asaas-access-token' ausente.",
        );
        response.status(401).json({ message: "Invalid Asaas Access Token" });
        return;
    }

    if (tokenRecebido !== HARDCODED_ASAAS_WEBHOOK_TOKEN) {
        console.warn(
            "[asaasWebhookAuthMiddleware] Token ASAAS inválido. Recebido:",
            tokenRecebido,
        );
        response.status(401).json({ message: "Invalid Asaas Access Token" });
        return;
    }

    console.log(
        "[asaasWebhookAuthMiddleware] Token ASAAS válido (força bruta, hardcoded no código).",
    );

    next();
}
