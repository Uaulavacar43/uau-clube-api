import { asaasApi } from "./asaasApi";
import type {
	ASAASCreatePaymentDTO,
	ASAASPaymentResponse,
	ASAASUpdatePaymentDTO,
} from "./types/paymentTypes";

/**
 * Creates a new payment in the ASAAS platform
 */
export async function asaasCreatePayment(
	data: ASAASCreatePaymentDTO,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.post("/payments", data);

	return response.data;
}

/**
 * Retrieves a payment by its ID from the ASAAS platform
 */
export async function asaasGetPayment(
	paymentId: string,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.get(`/payments/${paymentId}`);
	return response.data;
}

/**
 * Cancels a payment in the ASAAS platform
 */
export async function asaasCancelPayment(
	paymentId: string,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.delete(`/payments/${paymentId}`);
	return response.data;
}

/**
 * Updates an existing payment in the ASAAS platform
 */
export async function asaasUpdatePayment(
	paymentId: string,
	data: ASAASUpdatePaymentDTO,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.put(`/payments/${paymentId}`, data);
	return response.data;
}

/**
 * Lists all payments for a specific customer in the ASAAS platform
 */
export async function asaasListPayments(
	customerId: string,
): Promise<{ data: ASAASPaymentResponse[]; totalCount: number }> {
	const response = await asaasApi.get(`/payments`, {
		params: {
			customer: customerId,
		},
	});
	return response.data;
}

/**
 * Retrieves a QR Code for a PIX payment
 */
export async function asaasGetPixQrCode(
	paymentId: string,
): Promise<{ encodedImage: string; payload: string; expirationDate: string }> {
	const response = await asaasApi.get(`/payments/${paymentId}/pixQrCode`);
	return response.data;
}

/**
 * Confirms a payment received in cash
 */
export async function asaasConfirmReceiptInCash(
	paymentId: string,
	paymentDate: string,
	value: number,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.post(`/payments/${paymentId}/receiveInCash`, {
		paymentDate,
		value,
	});
	return response.data;
}

/**
 * Refunds a payment
 */
export async function asaasRefundPayment(
	paymentId: string,
	value?: number,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.post(
		`/payments/${paymentId}/refund`,
		value ? { value } : {},
	);
	return response.data;
}

/**
 * Creates a payment with credit card
 */
export async function asaasCreateCreditCardPayment(
	data: ASAASCreatePaymentDTO & { creditCard: any; creditCardHolderInfo: any },
	customerId: string,
): Promise<ASAASPaymentResponse> {
	const response = await asaasApi.post("/payments", {
		...data,
		customer: customerId,
		billingType: "CREDIT_CARD",
	});

	return response.data;
}

/**
 * Gets or creates a payment in the ASAAS platform
 */
export async function asaasGetOrCreatePayment(
	data: ASAASCreatePaymentDTO & { id?: string },
): Promise<ASAASPaymentResponse> {
	if (data.id) {
		let payment = await asaasGetPayment(data.id);
		if (data.value !== payment.value || data.dueDate !== payment.dueDate) {
			payment = await asaasUpdatePayment(data.id, data);
		}
		return payment;
	}

	return await asaasCreatePayment(data);
}
