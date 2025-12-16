import type { NextFunction, Request, Response } from "express";
import type { ValidateReferralDTO } from "./dto/ValidateReferralDTO";
import type { ReferralsService } from "./referrals.service";

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
}
