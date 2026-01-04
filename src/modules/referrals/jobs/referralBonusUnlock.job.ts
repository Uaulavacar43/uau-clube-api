// src/modules/referrals/jobs/referralBonusUnlock.job.ts

import cron from "node-cron";
import { ReferralBonusService } from "../ReferralBonusService";

export function startReferralBonusUnlockJob(referralBonusService: ReferralBonusService) {
    // todo dia 03:10 (Fortaleza)
    cron.schedule(
        "10 3 * * *",
        async () => {
            try {
                const res = await referralBonusService.processDueRecurrentBonuses(new Date());
                console.log(`[ReferralBonusUnlockJob] processed=${res.processed}`);
            } catch (err) {
                console.error("[ReferralBonusUnlockJob] error:", err);
            }
        },
        {
            timezone: "America/Fortaleza",
        },
    );
}
