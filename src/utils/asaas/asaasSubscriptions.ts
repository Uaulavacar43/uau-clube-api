import { asaasApi } from "./asaasApi";
import type {
	ASAASCreateSubscriptionDTO,
	ASAASSubscriptionListResponse,
	ASAASSubscriptionPaymentListResponse,
	ASAASSubscriptionResponse,
	ASAASUpdateSubscriptionDTO,
} from "./types/subscriptionTypes";

export async function asaasCreateSubscription(
	data: ASAASCreateSubscriptionDTO,
	customerId: string,
): Promise<ASAASSubscriptionResponse> {
	const response = await asaasApi.post("/subscriptions", {
		...data,
		customer: customerId,
	});

	return response.data;
}

export async function asaasGetSubscription(
	subscriptionId: string,
): Promise<ASAASSubscriptionResponse> {
	const response = await asaasApi.get(`/subscriptions/${subscriptionId}`);
	return response.data;
}

export async function asaasCancelSubscription(
	subscriptionId: string,
): Promise<ASAASSubscriptionResponse> {
	const response = await asaasApi.delete(`/subscriptions/${subscriptionId}`);
	return response.data;
}

export async function asaasUpdateSubscription(
	subscriptionId: string,
	data: ASAASUpdateSubscriptionDTO,
): Promise<ASAASSubscriptionResponse> {
	const response = await asaasApi.put(`/subscriptions/${subscriptionId}`, data);
	return response.data;
}

export async function asaasListSubscriptions(
	customerId: string,
): Promise<ASAASSubscriptionListResponse> {
	const response = await asaasApi.get(`/subscriptions`, {
		params: {
			customer: customerId,
		},
	});
	return response.data;
}

export async function asaasListSubscriptionPayments(
	subscriptionId: string,
): Promise<ASAASSubscriptionPaymentListResponse> {
	const response = await asaasApi.get(
		`/subscriptions/${subscriptionId}/payments`,
	);
	return response.data;
}

// export async function asaasGetOrCreateSubscription(data: ASAASCreateSubscriptionDTO, plan: Plan, customerId: string): Promise<ASAASSubscriptionResponse> {
// 	try {
// 		let subscription = await asaasGetSubscription(data.id);
// 		subscription = await asaasUpdateSubscription(data.subscriptionId, data);
// 		return subscription;
// 	} catch (_) {
// 		return await asaasCreateSubscription(data, plan, customerId);
// 	}
// }
