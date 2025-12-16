import type { WalletType } from "@prisma/client";

export class CashbackWallet {
    constructor(
        public readonly props: {
            id: number;
            userId: number;
            type: WalletType;
            balance: number;
            createdAt: Date;
            updatedAt: Date;
        },
    ) {}

    get id() {
        return this.props.id;
    }

    get userId() {
        return this.props.userId;
    }

    get type() {
        return this.props.type;
    }

    get balance() {
        return this.props.balance;
    }

    credit(amount: number) {
        this.props.balance += amount;
    }

    debit(amount: number) {
        this.props.balance -= amount;
    }
}
