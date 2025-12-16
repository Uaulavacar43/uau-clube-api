import type { ReferralBonus, PaymentStatus } from "../../entities/ReferralBonus";

export type ReferralBonusListResult = {
    total: number;
    data: ReferralBonus[];
};

export interface IReferralRepository {
    /**
     * Persiste um bônus de indicação.
     * Regra: eventKey é obrigatório e deve ser único (idempotência via persistence layer).
     */
    save(referralBonus: ReferralBonus): Promise<ReferralBonus>;

    /**
     * Idempotência genérica por eventKey (recomendado).
     * Use para garantir "no retry do webhook" não duplicar.
     */
    existsByEventKey(eventKey: string): Promise<boolean>;

    /**
     * Retorna true se já existir algum bônus UNIQUE gerado para o pagador
     * vinculado a uma assinatura específica (subscriptionId), independente do nível.
     *
     * Observação:
     * Como ReferralBonus não possui subscriptionId no schema, a forma correta de
     * suportar isso é padronizar o eventKey do UNIQUE com "sub:${subscriptionId}".
     */
    hasUniqueBonusForPayerSubscription(
        payerId: number,
        subscriptionId: number,
    ): Promise<boolean>;

    /**
     * Retorna true se já existir bônus RECURRENT para o pagador + competência + paymentId.
     * (Você pode usar isso como idempotência “de regra” além do existsByEventKey.)
     */
    hasRecurrentBonusForPayerPayment(
        payerId: number,
        paymentId: number,
        competenceYearMonth: string,
    ): Promise<boolean>;

    /**
     * Lista bônus recebidos (receiver) com paginação.
     */
    listByReceiver(
        receiverId: number,
        page: number,
        pageSize: number,
        filter?: {
            type?: "UNIQUE" | "RECURRENT";
            paymentStatus?: PaymentStatus;
            competenceYearMonth?: string;
        },
    ): Promise<ReferralBonusListResult>;

    /**
     * Atualiza status do bônus (PENDING -> PAID / CANCELED etc.)
     */
    updateStatus(id: number, paymentStatus: PaymentStatus): Promise<void>;
}
