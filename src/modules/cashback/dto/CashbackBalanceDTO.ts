import type { WalletType } from "@prisma/client";
import type { CashbackWallet } from "../../../entities/CashbackWallet";

type CashbackBalanceDTOProps = {
    userId: number;
    wallet: {
        id: number;
        userId: number;
        type: WalletType;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    } | null;
    earnedValid: number;
    earnedExpired: number;
    usedTotal: number;
    availableBalance: number;
    now: Date;
};

export class CashbackBalanceDTO {
    public readonly userId: number;

    public readonly wallet: CashbackBalanceDTOProps["wallet"];

    public readonly earnedValid: number;
    public readonly earnedExpired: number;
    public readonly usedTotal: number;
    public readonly availableBalance: number;
    public readonly now: Date;

    private constructor(props: CashbackBalanceDTOProps) {
        this.userId = props.userId;
        this.wallet = props.wallet;
        this.earnedValid = props.earnedValid;
        this.earnedExpired = props.earnedExpired;
        this.usedTotal = props.usedTotal;
        this.availableBalance = props.availableBalance;
        this.now = props.now;
    }

    public static from(params: {
        userId: number;
        wallet: CashbackWallet | null;
        earnedValid: number;
        earnedExpired: number;
        usedTotal: number;
        availableBalance: number;
        now: Date;
    }): CashbackBalanceDTO {
        return new CashbackBalanceDTO({
            userId: params.userId,
            wallet: params.wallet ? params.wallet.toJSON() : null,
            earnedValid: params.earnedValid,
            earnedExpired: params.earnedExpired,
            usedTotal: params.usedTotal,
            availableBalance: params.availableBalance,
            now: params.now,
        });
    }

    public toJSON() {
        return {
            userId: this.userId,
            wallet: this.wallet,
            earnedValid: this.earnedValid,
            earnedExpired: this.earnedExpired,
            usedTotal: this.usedTotal,
            availableBalance: this.availableBalance,
            now: this.now,
        };
    }
}
