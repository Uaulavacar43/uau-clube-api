import { TransactionSource, TransactionType } from "@prisma/client";

export class DebitCashbackDTO {
    userId: number;
    paymentId: number;

    /**
     * Valor total do pagamento/assinatura (base do limite de 50%)
     */
    paymentTotal: number;

    /**
     * Quanto o cliente está tentando usar de cashback
     */
    requestedAmount: number;

    constructor(params: DebitCashbackDTO) {
        this.userId = params.userId;
        this.paymentId = params.paymentId;
        this.paymentTotal = params.paymentTotal;
        this.requestedAmount = params.requestedAmount;
    }

    get type(): TransactionType {
        return TransactionType.USED;
    }

    get source(): TransactionSource {
        return TransactionSource.SUBSCRIPTION_DEBIT;
    }
}
