// src/utils/asaas/types/webhookTypes.ts

export enum ASAASWebhookEventEnum {
	PAYMENT_CREATED = "PAYMENT_CREATED",
	PAYMENT_UPDATED = "PAYMENT_UPDATED",
	PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED",
	PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
	PAYMENT_OVERDUE = "PAYMENT_OVERDUE",
	PAYMENT_DELETED = "PAYMENT_DELETED",
	PAYMENT_RESTORED = "PAYMENT_RESTORED",
	PAYMENT_REFUNDED = "PAYMENT_REFUNDED",
	PAYMENT_RECEIVED_IN_CASH_UNDONE = "PAYMENT_RECEIVED_IN_CASH_UNDONE",
	PAYMENT_CHARGEBACK_REQUESTED = "PAYMENT_CHARGEBACK_REQUESTED",
	PAYMENT_CHARGEBACK_DISPUTE = "PAYMENT_CHARGEBACK_DISPUTE",
	PAYMENT_AWAITING_CHARGEBACK_REVERSAL = "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
	PAYMENT_DUNNING_RECEIVED = "PAYMENT_DUNNING_RECEIVED",
	PAYMENT_DUNNING_REQUESTED = "PAYMENT_DUNNING_REQUESTED",
	PAYMENT_BANK_SLIP_VIEWED = "PAYMENT_BANK_SLIP_VIEWED",
	PAYMENT_CHECKOUT_VIEWED = "PAYMENT_CHECKOUT_VIEWED",
	SUBSCRIPTION_CREATED = "SUBSCRIPTION_CREATED",
	SUBSCRIPTION_UPDATED = "SUBSCRIPTION_UPDATED",
	SUBSCRIPTION_DELETED = "SUBSCRIPTION_DELETED",
	SUBSCRIPTION_RENEWED = "SUBSCRIPTION_RENEWED",
	SUBSCRIPTION_OVERDUE = "SUBSCRIPTION_OVERDUE",
	SUBSCRIPTION_ENDED = "SUBSCRIPTION_ENDED",
	SUBSCRIPTION_ACTIVATED = "SUBSCRIPTION_ACTIVATED",
	SUBSCRIPTION_EXPIRED = "SUBSCRIPTION_EXPIRED",
}

/** Info si es un evento de pago */
export interface ASAASWebhookPayment {
	object: "payment";
	id: string;
	dateCreated: string;
	customer: string;
	subscription?: string;
	dueDate: string;
	value: number;
	netValue: number;
	billingType: string;
	status: string;
	description?: string;
	installment?: string;
	externalReference?: string;
	confirmedDate?: string;
	paymentDate?: string;
	clientPaymentDate?: string;
	installmentNumber?: number;
	discount?: {
		value: number;
		dueDateLimitDays: number;
		type: "FIXED" | "PERCENTAGE";
	};
	fine?: {
		value: number;
		type: "FIXED" | "PERCENTAGE";
	};
	interest?: {
		value: number;
	};
	deleted: boolean;
	postalService: boolean;
	anticipated: boolean;
}

/** Info si es un evento de suscripción */
export interface ASAASWebhookSubscription {
	object: "subscription";
	id: string;
	dateCreated: string;
	customer: string;
	paymentLink?: string;
	value: number;
	nextDueDate: string;
	cycle: string;
	description: string;
	billingType: string;
	status: string;
	discount?: {
		value: number;
		dueDateLimitDays: number;
		type: "FIXED" | "PERCENTAGE";
	};
	fine?: {
		value: number;
		type: "FIXED" | "PERCENTAGE";
	};
	interest?: {
		value: number;
	};
	deleted: boolean;
	externalReference?: string;
}

/** Un único tipo para el evento ASAAS, con propiedades opcionales */
export interface ASAASWebhookEvent {
	event: ASAASWebhookEventEnum;
	payment?: ASAASWebhookPayment;
	subscription?: ASAASWebhookSubscription;
}

export interface ASAASWebhookErrorResponse {
	errors: Array<{
		code: string;
		description: string;
	}>;
}
