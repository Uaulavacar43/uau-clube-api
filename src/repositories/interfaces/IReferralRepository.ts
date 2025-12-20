// src/repositories/interfaces/IReferralRepository.ts

import type { BonusType, PaymentStatus } from "@prisma/client";
import type { ReferralBonus } from "../../entities/ReferralBonus";

export type ReferralBonusListFilter = {
    type?: BonusType; // "UNIQUE" | "RECURRENT"
    paymentStatus?: PaymentStatus; // "PAID" | "PENDING" | "CANCELED"
    competenceYearMonth?: string; // "YYYY-MM" (apenas para RECURRENT)
};

export type ReferralBonusListResult = {
    total: number;
    data: ReferralBonus[];
};

export interface IReferralRepository {
    /**
     * Persiste um bônus de indicação.
     *
     * Regras:
     * - eventKey é obrigatório e deve ser único (idempotência via persistence layer).
     * - Idealmente, a implementação deve depender de um unique index em ReferralBonus.eventKey
     *   e tratar P2002 para garantir idempotência em concorrência/retry de webhook.
     */
    save(referralBonus: ReferralBonus): Promise<ReferralBonus>;

    /**
     * Idempotência genérica por eventKey (recomendado).
     * Use para garantir que retries (webhook/job) não dupliquem bônus.
     */
    existsByEventKey(eventKey: string): Promise<boolean>;

    /**
     * Retorna true se já existir algum bônus UNIQUE gerado para o pagador
     * vinculado a uma assinatura específica (subscriptionId), independente do nível.
     *
     * Observação:
     * Como ReferralBonus não possui subscriptionId no schema, a forma correta de
     * suportar isso é padronizar o eventKey do UNIQUE com algo como:
     * "UNIQUE:subscription:{subscriptionId}:payer:{payerId}:level:{level}:receiver:{receiverId}"
     *
     * Implementação recomendada:
     * - buscar por eventKey contendo "UNIQUE:subscription:{subscriptionId}:payer:{payerId}:"
     * - OU persistir uma regra de idempotência equivalente baseada em eventKey prefix.
     */
    hasUniqueBonusForPayerSubscription(
        payerId: number,
        subscriptionId: number,
    ): Promise<boolean>;

    /**
     * Retorna true se já existir bônus RECURRENT para:
     * payerId + paymentId + competenceYearMonth
     *
     * Observação:
     * Mesmo que exista existsByEventKey, este método é útil como “idempotência de regra”.
     */
    hasRecurrentBonusForPayerPayment(
        payerId: number,
        paymentId: number,
        competenceYearMonth: string,
    ): Promise<boolean>;

    /**
     * Lista bônus recebidos (receiver) com paginação.
     *
     * page: 1..N
     * pageSize: 1..N
     */
    listByReceiver(
        receiverId: number,
        page: number,
        pageSize: number,
        filter?: ReferralBonusListFilter,
    ): Promise<ReferralBonusListResult>;

    /**
     * Atualiza status do bônus (ex.: PENDING -> PAID / CANCELED).
     */
    updateStatus(id: number, paymentStatus: PaymentStatus): Promise<void>;
}
