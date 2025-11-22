import { randomUUID } from "crypto";

interface WebhookErrorData {
	id?: string;
	statusCode?: number | null; // Agregamos statusCode
	subscription_id?: string | null;
	payment_id?: string | null;
	user_id?: string | null;
	payload: Record<string, unknown>;
	response: Record<string, unknown>;
	createdAt?: Date;
}

class WebhookError {
	id: string;
	statusCode?: number | null; // Agregamos statusCode
	subscription_id?: string | null;
	payment_id?: string | null;
	user_id?: string | null;
	payload: Record<string, unknown>;
	response: Record<string, unknown>;
	createdAt: Date;

	constructor(data: WebhookErrorData) {
		this.id = data.id ?? randomUUID();
		this.statusCode = data.statusCode ?? null; // Asegurar compatibilidad
		this.subscription_id = data.subscription_id;
		this.payment_id = data.payment_id;
		this.user_id = data.user_id;
		this.payload = data.payload;
		this.response = data.response;
		this.createdAt = data.createdAt ?? new Date();
	}
}

export default WebhookError;
