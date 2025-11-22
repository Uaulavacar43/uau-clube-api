export enum ASAASPaymentBillingTypeEnum {
	BOLETO = "BOLETO",
	CREDIT_CARD = "CREDIT_CARD",
	PIX = "PIX",
	UNDEFINED = "UNDEFINED",
}

export enum ASAASPaymentStatusEnum {
	PENDING = "PENDING",
	RECEIVED = "RECEIVED",
	CONFIRMED = "CONFIRMED",
	OVERDUE = "OVERDUE",
	REFUNDED = "REFUNDED",
	RECEIVED_IN_CASH = "RECEIVED_IN_CASH",
	REFUND_REQUESTED = "REFUND_REQUESTED",
	CHARGEBACK_REQUESTED = "CHARGEBACK_REQUESTED",
	CHARGEBACK_DISPUTE = "CHARGEBACK_DISPUTE",
	AWAITING_CHARGEBACK_REVERSAL = "AWAITING_CHARGEBACK_REVERSAL",
	DUNNING_REQUESTED = "DUNNING_REQUESTED",
	DUNNING_RECEIVED = "DUNNING_RECEIVED",
	AWAITING_RISK_ANALYSIS = "AWAITING_RISK_ANALYSIS",
}

export interface ASAASCreditCardHolderInfo {
	name: string;
	email: string;
	cpfCnpj: string;
	postalCode: string;
	addressNumber: string;
	addressComplement?: string;
	phone: string;
	mobilePhone?: string;
}

export interface ASAASCreditCard {
	holderName: string;
	number: string;
	expiryMonth: string;
	expiryYear: string;
	ccv: string;
}

export interface ASAASCreatePaymentDTO {
	customer: string;
	billingType: ASAASPaymentBillingTypeEnum;
	dueDate: string;
	value: number;
	installmentCount?: number;
	totalValue?: number;
	description?: string;
	externalReference?: string;
	discount?: {
		value: number;
		dueDateLimitDays?: number;
		type: "FIXED" | "PERCENTAGE";
	};
	fine?: {
		value: number;
		type: "FIXED" | "PERCENTAGE";
	};
	interest?: {
		value: number;
	};
	split?: Array<{
		walletId: string;
		fixedValue?: number;
		percentualValue?: number;
	}>;
	creditCard?: ASAASCreditCard;
	creditCardHolderInfo?: ASAASCreditCardHolderInfo;
	creditCardToken?: string;
	remoteIp?: string;
	postalService?: boolean;
}

export interface ASAASUpdatePaymentDTO {
	billingType?: ASAASPaymentBillingTypeEnum;
	value?: number;
	dueDate?: string;
	description?: string;
	externalReference?: string;
	discount?: {
		value: number;
		dueDateLimitDays?: number;
		type: "FIXED" | "PERCENTAGE";
	};
	fine?: {
		value: number;
		type: "FIXED" | "PERCENTAGE";
	};
	interest?: {
		value: number;
	};
	split?: Array<{
		walletId: string;
		fixedValue?: number;
		percentualValue?: number;
	}>;
	creditCard?: ASAASCreditCard;
	creditCardHolderInfo?: ASAASCreditCardHolderInfo;
	creditCardToken?: string;
	remoteIp?: string;
	postalService?: boolean;
}

export interface ASAASPaymentResponse {
	id: string;
	dateCreated: string;
	customer: string;
	paymentLink?: string | null;
	dueDate: string;
	value: number;
	netValue: number;
	billingType: ASAASPaymentBillingTypeEnum;
	status: ASAASPaymentStatusEnum;
	installment?: string | null;
	description: string | null;
	externalReference?: string | null;
	originalValue?: number | null;
	interestValue?: number | null;
	fineValue?: number | null;
	discountValue?: number | null;
	nossoNumero?: string | null;
	invoiceUrl?: string | null;
	bankSlipUrl?: string | null;
	transactionReceiptUrl?: string | null;
	invoiceNumber?: string | null;
	deleted: boolean;
	anticipated: boolean;
	creditCard?: {
		creditCardNumber: string;
		creditCardBrand: string;
		creditCardToken: string;
	} | null;
	pixTransaction?: {
		encodedImage: string;
		payload: string;
		expirationDate: string;
	} | null;
}

export interface ASAASErrorResponse {
	errors: Array<{
		code: string;
		description: string;
	}>;
}
