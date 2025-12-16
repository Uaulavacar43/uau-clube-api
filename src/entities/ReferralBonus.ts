export type BonusType = "UNIQUE" | "RECURRENT";

/**
 * Mantido compatível com teu enum PaymentStatus do Prisma:
 * PAID | PENDING | CANCELED
 */
export type PaymentStatus = "PAID" | "PENDING" | "CANCELED";

export interface ReferralBonusProps {
    /**
     * ID gerado pelo banco (autoincrement).
     * Deve ser opcional na criação (antes de persistir).
     */
    id?: number;

    /**
     * Quem recebe o bônus (upline).
     */
    receiverId: number;

    /**
     * Quem gerou o bônus (o indicado que paga/assina/compra).
     */
    payerId: number;

    /**
     * 1, 2 ou 3.
     */
    level: number;

    type: BonusType;
    amount: number;

    /**
     * Status do pagamento do bônus.
     * Normalmente nasce como PENDING e vira PAID quando o gatilho ocorrer (ex: 1ª assinatura paga).
     */
    paymentStatus: PaymentStatus;

    createdAt?: Date;
}

export class ReferralBonus {
    public id: number | null;

    public receiverId: number;
    public payerId: number;
    public level: number;

    public type: BonusType;
    public amount: number;

    public paymentStatus: PaymentStatus;

    public createdAt: Date;

    constructor(props: ReferralBonusProps) {
        if (!props) {
            throw new Error("ReferralBonusProps é obrigatório.");
        }

        if (!Number.isInteger(props.receiverId) || props.receiverId <= 0) {
            throw new Error("receiverId inválido.");
        }

        if (!Number.isInteger(props.payerId) || props.payerId <= 0) {
            throw new Error("payerId inválido.");
        }

        if (!Number.isInteger(props.level) || props.level < 1 || props.level > 3) {
            throw new Error("level inválido. Deve ser 1, 2 ou 3.");
        }

        if (props.amount === null || props.amount === undefined || Number.isNaN(props.amount)) {
            throw new Error("amount inválido.");
        }

        if (props.amount <= 0) {
            throw new Error("amount inválido. Deve ser maior que zero.");
        }

        if (props.type !== "UNIQUE" && props.type !== "RECURRENT") {
            throw new Error('type inválido. Deve ser "UNIQUE" ou "RECURRENT".');
        }

        if (
            props.paymentStatus !== "PAID" &&
            props.paymentStatus !== "PENDING" &&
            props.paymentStatus !== "CANCELED"
        ) {
            throw new Error('paymentStatus inválido. Deve ser "PAID", "PENDING" ou "CANCELED".');
        }

        this.id = props.id ?? null;
        this.receiverId = props.receiverId;
        this.payerId = props.payerId;
        this.level = props.level;
        this.type = props.type;
        this.amount = props.amount;
        this.paymentStatus = props.paymentStatus;
        this.createdAt = props.createdAt ?? new Date();
    }

    public markAsPaid(): void {
        this.paymentStatus = "PAID";
    }

    public cancel(): void {
        this.paymentStatus = "CANCELED";
    }
}
