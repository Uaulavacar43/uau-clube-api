import type { NextFunction, Request, Response } from "express";
import {ValidateReferralDTO} from "../modules/referrals/dto/ValidateReferralDTO";

export function validateReferralBody(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const parsed = ValidateReferralDTO.safeParse(req.body);

    if (!parsed.success) {
        const message = parsed.error.errors?.[0]?.message ?? "Payload inválido";
        res.status(400).json({ message, issues: parsed.error.errors });
        return;
    }

    // Mantém o mesmo padrão que vocês usam no AuthController (res.locals como DTO)
    res.locals = parsed.data;
    next();
}
