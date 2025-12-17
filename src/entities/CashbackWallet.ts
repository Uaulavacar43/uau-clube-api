import type { WalletType } from "@prisma/client";

export interface CashbackWalletProps {
    id: number;
    userId: number;
    type: WalletType;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
}

export class CashbackWallet {
    public readonly id: number;
    public readonly userId: number;
    public readonly type: WalletType;
    public readonly balance: number;
    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    constructor(props: CashbackWalletProps) {
        if (!props) throw new Error("CashbackWalletProps é obrigatório.");

        if (!Number.isInteger(props.id) || props.id <= 0) {
            throw new Error("id inválido.");
        }

        if (!Number.isInteger(props.userId) || props.userId <= 0) {
            throw new Error("userId inválido.");
        }

        this.id = props.id;
        this.userId = props.userId;
        this.type = props.type;
        this.balance = props.balance;
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
    }

    public toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            type: this.type,
            balance: this.balance,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}
