import { ASAASWebhookEventEnum } from "./types/webhookTypes";

export const ASAAS_EVENT_STATUS_MAP: Record<
	ASAASWebhookEventEnum,
	"PAID" | "PENDING" | "CANCELED" | undefined
> = {
	[ASAASWebhookEventEnum.PAYMENT_CREATED]: "PENDING",
	[ASAASWebhookEventEnum.PAYMENT_UPDATED]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_CONFIRMED]: "PAID",
	[ASAASWebhookEventEnum.PAYMENT_RECEIVED]: "PAID",
	[ASAASWebhookEventEnum.PAYMENT_OVERDUE]: "CANCELED",
	[ASAASWebhookEventEnum.PAYMENT_DELETED]: "CANCELED",
	[ASAASWebhookEventEnum.PAYMENT_RESTORED]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_REFUNDED]: "CANCELED",
	[ASAASWebhookEventEnum.PAYMENT_RECEIVED_IN_CASH_UNDONE]: "CANCELED",
	[ASAASWebhookEventEnum.PAYMENT_CHARGEBACK_REQUESTED]: "CANCELED",
	[ASAASWebhookEventEnum.PAYMENT_CHARGEBACK_DISPUTE]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_AWAITING_CHARGEBACK_REVERSAL]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_DUNNING_RECEIVED]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_DUNNING_REQUESTED]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_BANK_SLIP_VIEWED]: undefined,
	[ASAASWebhookEventEnum.PAYMENT_CHECKOUT_VIEWED]: undefined,

	// Suscripciones
	[ASAASWebhookEventEnum.SUBSCRIPTION_CREATED]: "PAID",
	[ASAASWebhookEventEnum.SUBSCRIPTION_UPDATED]: undefined,
	[ASAASWebhookEventEnum.SUBSCRIPTION_DELETED]: "CANCELED",
	[ASAASWebhookEventEnum.SUBSCRIPTION_RENEWED]: undefined,
	[ASAASWebhookEventEnum.SUBSCRIPTION_OVERDUE]: "CANCELED",
	[ASAASWebhookEventEnum.SUBSCRIPTION_ENDED]: "CANCELED",
	[ASAASWebhookEventEnum.SUBSCRIPTION_ACTIVATED]: undefined,
	[ASAASWebhookEventEnum.SUBSCRIPTION_EXPIRED]: "CANCELED",
};
