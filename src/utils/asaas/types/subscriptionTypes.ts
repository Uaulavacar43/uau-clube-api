export enum ASAASSubscriptionCycleEnum {
	WEEKLY = "WEEKLY",
	BIWEEKLY = "BIWEEKLY",
	MONTHLY = "MONTHLY",
	QUARTERLY = "QUARTERLY",
	SEMIANNUALLY = "SEMIANNUALLY",
	YEARLY = "YEARLY",
}

export enum ASAASSubscriptionBillingTypeEnum {
	BOLETO = "BOLETO",
	CREDIT_CARD = "CREDIT_CARD",
	PIX = "PIX",
}

export enum ASAASSubscriptionStatusEnum {
	ACTIVE = "ACTIVE",
	EXPIRED = "EXPIRED",
	CANCELLED = "CANCELLED",
	OVERDUE = "OVERDUE",
	INACTIVE = "INACTIVE",
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

export interface ASAASCreateSubscriptionDTO {
	customer: string;
	billingType: ASAASSubscriptionBillingTypeEnum;
	nextDueDate: string;
	value: number;
	cycle: ASAASSubscriptionCycleEnum;
	description?: string;
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
	creditCard?: ASAASCreditCard;
	creditCardHolderInfo?: ASAASCreditCardHolderInfo;
	externalReference?: string;
	postalService?: boolean;
	charge?: {
		value: number;
		dueDate: string;
		billingType: ASAASSubscriptionBillingTypeEnum;
	};
}

export interface ASAASSubscriptionResponse {
	id: string;
	dateCreated: string;
	customer: string;
	paymentLink?: string | null;
	billingType: ASAASSubscriptionBillingTypeEnum;
	value: number;
	nextDueDate: string;
	cycle: ASAASSubscriptionCycleEnum;
	description: string | null;
	status: ASAASSubscriptionStatusEnum;
	discount?: {
		value: number;
		dueDateLimitDays: number;
		type: "FIXED" | "PERCENTAGE";
	} | null;
	fine?: {
		value: number;
		type: "FIXED" | "PERCENTAGE";
	} | null;
	interest?: {
		value: number;
	} | null;
	deleted: boolean;
	externalReference?: string | null;
}

export interface ASAASSubscriptionListResponse {
	object: string;
	hasMore: boolean;
	totalCount: number;
	limit: number;
	offset: number;
	data: ASAASSubscriptionResponse[];
}

export interface ASAASUpdateSubscriptionDTO {
	billingType?: ASAASSubscriptionBillingTypeEnum;
	value?: number;
	nextDueDate?: string;
	description?: string;
	status?: ASAASSubscriptionStatusEnum;
	cycle?: ASAASSubscriptionCycleEnum;
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
	creditCard?: ASAASCreditCard;
	creditCardHolderInfo?: ASAASCreditCardHolderInfo;
	externalReference?: string;
	postalService?: boolean;
}

export interface ASAASErrorResponse {
	errors: Array<{
		code: string;
		description: string;
	}>;
}

export interface ASAASSubscriptionPaymentListResponse {
	object: string;
	hasMore: boolean;
	totalCount: number;
	limit: number;
	offset: number;
	data: {
		object: string;
		id: string;
		dateCreated: Date;
		customer: string;
		subscription: string;
		checkoutSession: null;
		paymentLink: null;
		value: number;
		netValue: number;
		originalValue: null;
		interestValue: null;
		description: null;
		billingType: string;
		pixTransaction: null;
		status: string;
		dueDate: Date;
		originalDueDate: Date;
		paymentDate: null;
		clientPaymentDate: null;
		installmentNumber: null;
		invoiceUrl: string;
		invoiceNumber: string;
		externalReference: null;
		deleted: boolean;
		anticipated: boolean;
		anticipable: boolean;
		creditDate: null;
		estimatedCreditDate: null;
		transactionReceiptUrl: null;
		nossoNumero: null;
		bankSlipUrl: null;
		lastInvoiceViewedDate: null;
		lastBankSlipViewedDate: null;
		discount: {
			value: number;
			limitDate: null;
			dueDateLimitDays: number;
			type: string;
		};
		fine: {
			value: number;
			type: string;
		};
		interest: {
			value: number;
			type: string;
		};
		postalService: boolean;
		custody: null;
		escrow: null;
		refunds: null;
	}[];
}
