import { ReferralBonus } from '../../entities/ReferralBonus';

export interface IReferralRepository {
    save(referralBonus: ReferralBonus): Promise<ReferralBonus>;
}
