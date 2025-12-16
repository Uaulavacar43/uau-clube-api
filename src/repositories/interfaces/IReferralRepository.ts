import { ReferralBonus } from "../../entities/ReferralBonus";

export interface IReferralRepository {
    /**
     * Persiste um bônus de indicação.
     * Regra: eventKey é obrigatório e deve ser único (idempotência via persistence layer).
     */
    save(referralBonus: ReferralBonus): Promise<ReferralBonus>;

    /**
     * Retorna true se já existir algum bônus UNIQUE gerado para o pagador
     * vinculado a uma assinatura específica (subscriptionId), independente do nível.
     *
     * Observação: como a idempotência é garantida por eventKey, este método pode
     * consultar por prefixo de eventKey.
     */
    hasUniqueBonusForPayerSubscription(
        payerId: number,
        subscriptionId: number,
    ): Promise<boolean>;
}
