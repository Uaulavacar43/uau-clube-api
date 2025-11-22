// src/utils/asaas/asaasCustomer.ts

import type { User } from "../../entities/User";
import { asaasApi } from "./asaasApi";
import type {
	ASAASCreateCustomerDTO,
	ASAASCustomerResponse,
	ASAASListCustomersResponse,
	ASAASUpdateCustomerDTO,
} from "./types/customerTypes";

function sanitizeCpfCnpj(cpfCnpj: string): string {
	return cpfCnpj.replace(/\D/g, "");
}

/**
 * Recibe:
 * - data: info principal para crear el cliente en ASAAS
 * - user (opcional): por si quieres complementar datos como email, phone, etc.
 */
export async function asaasCreateCustomer(
	data: ASAASCreateCustomerDTO,
	user?: User,
): Promise<ASAASCustomerResponse> {
	// Combinamos data con info del user, si hace falta
	const payload: ASAASCreateCustomerDTO = {
		...data,
	};

	// Si el user trae email/phone y no vienen en data, se pueden asignar
	if (user) {
		if (!payload.email && user.email) {
			payload.email = user.email;
		}
		if (!payload.phone && user.phone) {
			payload.phone = user.phone;
		}
	}

	// Llamada a ASAAS
	const response = await asaasApi.post("/customers", payload);
	return response.data;
}

export async function asaasGetCustomerByCpfCnpj(
	cpfCnpj: string,
): Promise<ASAASCustomerResponse | undefined> {
	const response = await asaasApi.get<ASAASListCustomersResponse>(
		"/customers",
		{
			params: {
				cpfCnpj: sanitizeCpfCnpj(cpfCnpj),
			},
		},
	);

	if (response.data.data.length === 0) return undefined;

	return response.data.data.find(
		(customer) =>
			sanitizeCpfCnpj(customer.cpfCnpj) === sanitizeCpfCnpj(cpfCnpj),
	);
}

export async function asaasUpdateCustomer(
	customerId: string,
	data: ASAASUpdateCustomerDTO,
): Promise<ASAASCustomerResponse> {
	const response = await asaasApi.put(`/customers/${customerId}`, data);
	return response.data;
}

/**
 * Ejemplo de "Get Or Create":
 * 1. Busca por CPF/CNPJ
 * 2. Si no existe, crea uno nuevo.
 */
export async function asaasGetOrCreateCustomerByCpfCnpj(
	data: ASAASCreateCustomerDTO,
): Promise<ASAASCustomerResponse> {
	try {
		let customer = await asaasGetCustomerByCpfCnpj(data.cpfCnpj);
		if (!customer) throw new Error("Customer not found");
		customer = await asaasUpdateCustomer(customer.id, data);
		return customer;
	} catch (_) {
		console.warn("Não encontrado o cliente no ASAAS, criando um novo...");
		return await asaasCreateCustomer(data);
	}
}
