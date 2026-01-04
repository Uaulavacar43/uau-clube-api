// src/server.ts

import app from "./app";
import { envConfig } from "./config/envConfig";

import { startReferralBonusUnlockJob } from "./modules/referrals/jobs/referralBonusUnlock.job";
import { referralBonusService } from "./modules/referrals/referralBonusServiceInstance";

const port = Number(envConfig.PORT) || 3000;

// ✅ inicia o job UMA vez por processo
startReferralBonusUnlockJob(referralBonusService);

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
