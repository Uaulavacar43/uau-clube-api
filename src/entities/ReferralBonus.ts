export type BonusType = "UNIQUE" | "RECURRENT";
export type PaymentStatus = "PAID" | "PENDING" | "CANCELED";

export interface ReferralBonusProps {
    id?: number;

    receiverId: number;
    payerId: number;

    /**
     * 1, 2 ou 3
     */
    level: number;

    type: BonusType;
    amount: number;

    paymentStatus: PaymentStatus;

    /**
     * 🔐 Idempotência (obrigatória no persistence layer)
     * - UNIQUE: pode ser gerado a partir de subscriptionId (se informado)
     * - RECURRENT: pode ser gerado a partir de competenceYearMonth
     */
    eventKey?: string;

    /**
     * Vínculo opcional com a assinatura local (recomendado para UNIQUE de assinatura)
     */
    subscriptionId?: number;

    /**
     * YYYY-MM (obrigatório para RECURRENT)
     */
    competenceYearMonth?: string;

    /**
     * Payment que originou o bônus (Fase 2 / 4)
     */
    paymentId?: number;

    createdAt?: Date;
    updatedAt?: Date;
}

export class ReferralBonus {
    public readonly id: number | null;

    public readonly receiverId: number;
    public readonly payerId: number;
    public readonly level: number;

    public readonly type: BonusType;
    public readonly amount: number;

    public paymentStatus: PaymentStatus;

    public readonly subscriptionId?: number;
    public readonly eventKey: string;

    public readonly competenceYearMonth?: string;
    public readonly paymentId?: number;

    public readonly createdAt: Date;
    public readonly updatedAt?: Date;

    constructor(props: ReferralBonusProps) {
        if (!props) throw new Error("ReferralBonusProps é obrigatório.");

        if (!Number.isInteger(props.receiverId) || props.receiverId <= 0) {
            throw new Error("receiverId inválido.");
        }

        if (!Number.isInteger(props.payerId) || props.payerId <= 0) {
            throw new Error("payerId inválido.");
        }

        if (!Number.isInteger(props.level) || props.level < 1 || props.level > 3) {
            throw new Error("level inválido. Deve ser 1, 2 ou 3.");
        }

        if (props.amount <= 0) {
            throw new Error("amount inválido.");
        }

        if (props.type !== "UNIQUE" && props.type !== "RECURRENT") {
            throw new Error("type inválido.");
        }

        if (props.subscriptionId !== undefined) {
            if (!Number.isInteger(props.subscriptionId) || props.subscriptionId <= 0) {
                throw new Error("subscriptionId inválido.");
            }
        }

        if (props.type === "RECURRENT") {
            const ym = (props.competenceYearMonth ?? "").trim();
            // formato mínimo YYYY-MM
            if (!/^\d{4}-\d{2}$/.test(ym)) {
                throw new Error(
                    "competenceYearMonth inválido. Deve ser no formato YYYY-MM (obrigatório para RECURRENT).",
                );
            }
        }

        this.id = props.id ?? null;

        this.receiverId = props.receiverId;
        this.payerId = props.payerId;
        this.level = props.level;

        this.type = props.type;
        this.amount = props.amount;

        this.paymentStatus = props.paymentStatus;

        this.subscriptionId = props.subscriptionId;
        this.competenceYearMonth = props.competenceYearMonth?.trim() || undefined;
        this.paymentId = props.paymentId;

        this.createdAt = props.createdAt ?? new Date();
        this.updatedAt = props.updatedAt;

        // -------------------------
        // eventKey: obrigatório (idempotência)
        // -------------------------
        const providedEventKey = (props.eventKey ?? "").trim();

        if (providedEventKey) {
            this.eventKey = providedEventKey;
            return;
        }

        // Geração automática (recomendada) para não depender do service/controller
        this.eventKey = this.buildEventKey({
            type: this.type,
            payerId: this.payerId,
            receiverId: this.receiverId,
            level: this.level,
            subscriptionId: this.subscriptionId,
            competenceYearMonth: this.competenceYearMonth,
        });
    }

    private buildEventKey(input: {
        type: BonusType;
        payerId: number;
        receiverId: number;
        level: number;
        subscriptionId?: number;
        competenceYearMonth?: string;
    }): string {
        if (input.type === "UNIQUE") {
            // Preferência: UNIQUE por assinatura (primeiro PAID da subscription)
            if (input.subscriptionId) {
                return `UNIQUE:SUB:${input.subscriptionId}:PAYER:${input.payerId}:L${input.level}`;
            }

            // Se você quiser permitir UNIQUE sem assinatura, mantenha isso.
            // Caso contrário, troque para throw.
            return `UNIQUE:PAYER:${input.payerId}:RECEIVER:${input.receiverId}:L${input.level}`;
        }

        // RECURRENT exige competenceYearMonth
        if (!input.competenceYearMonth) {
            throw new Error(
                "eventKey não fornecido e não foi possível gerar: competenceYearMonth ausente (RECURRENT).",
            );
        }

        return `RECURRENT:${input.competenceYearMonth}:PAYER:${input.payerId}:L${input.level}`;
    }

    public markAsPaid(): void {
        this.paymentStatus = "PAID";
    }

    public cancel(): void {
        this.paymentStatus = "CANCELED";
    }
}
