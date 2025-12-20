import type { NextFunction, Request, Response } from "express";
import type { ValidateReferralDTO } from "./dto/ValidateReferralDTO";
import type { ReferralsService } from "./referrals.service";
import type { ReferralSource } from "../../repositories/interfaces/IUserRepository";

type AttachReferralOnSignupBody = {
    userId: number;

    referralCode?: string;
    referrerId?: number;

    source?: ReferralSource;

    deviceId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: unknown;
};

export class ReferralsController {
    constructor(private readonly referralsService: ReferralsService) {}

    /**
     * POST /referrals/validate
     * Body: { referralCode: string }
     */
    public async validateReferral(
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const data = res.locals as ValidateReferralDTO;

            const result = await this.referralsService.validateReferral(
                data.referralCode,
            );

            res.status(200).customJson(result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /referrals/attach
     *
     * Body:
     * {
     *   userId: number,
     *   referralCode?: string,
     *   referrerId?: number,
     *   source?: ReferralSource,
     *   deviceId?: string | null,
     *   ip?: string | null,
     *   userAgent?: string | null,
     *   meta?: unknown
     * }
     *
     * Observação:
     * - Este endpoint chama attachReferralOnSignup para que o método não fique “Unused”.
     * - Se você quiser validação antes de entrar aqui, você pode criar um DTO + middleware depois.
     */
    public async attachReferralOnSignup(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        try {
            const body = req.body as AttachReferralOnSignupBody;

            await this.referralsService.attachReferralOnSignup({
                userId: Number(body.userId),
                referralCode: body.referralCode,
                referrerId:
                    body.referrerId !== undefined && body.referrerId !== null
                        ? Number(body.referrerId)
                        : undefined,
                source: body.source,
                deviceId: body.deviceId ?? null,
                ip: body.ip ?? null,
                userAgent: body.userAgent ?? null,
                meta: body.meta,
            });

            res.status(200).customJson({ ok: true });
        } catch (error) {
            next(error);
        }
    }
}
