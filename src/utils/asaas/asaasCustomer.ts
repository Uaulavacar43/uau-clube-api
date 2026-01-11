// src/utils/asaas/asaasCustomer.ts

import type { User } from "../../entities/User";
import { AppError } from "../../error/AppError";
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
	console.log("[asaasCreateCustomer] Enviando requisição para ASAAS:", {
		name: payload.name,
		cpfCnpj: `${sanitizeCpfCnpj(payload.cpfCnpj).substring(0, 3)}***`,
		hasEmail: !!payload.email,
		hasPhone: !!payload.phone,
	});
	
	const response = await asaasApi.post("/customers", payload);
	
	console.log("[asaasCreateCustomer] Resposta do ASAAS:", {
		hasData: !!response.data,
		hasId: !!response.data?.id,
		customerId: response.data?.id,
		status: response.status,
	});
	
	return response.data;
}

export async function asaasGetCustomerByCpfCnpj(
	cpfCnpj: string,
): Promise<ASAASCustomerResponse | undefined> {
	const sanitizedCpf = sanitizeCpfCnpj(cpfCnpj);
	
	console.log("[asaasGetCustomerByCpfCnpj] Buscando cliente por CPF/CNPJ:", {
		cpfCnpj: `${sanitizedCpf.substring(0, 3)}***`,
	});
	
	const response = await asaasApi.get<ASAASListCustomersResponse>(
		"/customers",
		{
			params: {
				cpfCnpj: sanitizedCpf,
			},
		},
	);

	console.log("[asaasGetCustomerByCpfCnpj] Resposta da busca:", {
		totalCount: response.data.totalCount,
		dataLength: response.data.data.length,
		hasMore: response.data.hasMore,
	});

	if (response.data.data.length === 0) {
		console.log("[asaasGetCustomerByCpfCnpj] Nenhum cliente encontrado");
		return undefined;
	}

	const customer = response.data.data.find(
		(customer) =>
			sanitizeCpfCnpj(customer.cpfCnpj) === sanitizedCpf,
	);
	
	if (customer) {
		console.log("[asaasGetCustomerByCpfCnpj] Cliente encontrado:", {
			customerId: customer.id,
			customerName: customer.name,
		});
	} else {
		console.log("[asaasGetCustomerByCpfCnpj] Cliente não encontrado na lista (CPF não corresponde)");
	}

	return customer;
}

export async function asaasUpdateCustomer(
	customerId: string,
	data: ASAASUpdateCustomerDTO,
): Promise<ASAASCustomerResponse> {
	console.log("[asaasUpdateCustomer] Atualizando cliente:", {
		customerId,
		hasName: !!data.name,
		hasEmail: !!data.email,
		hasPhone: !!data.phone,
	});
	
	const response = await asaasApi.put(`/customers/${customerId}`, data);
	
	console.log("[asaasUpdateCustomer] Resposta do ASAAS:", {
		hasData: !!response.data,
		hasId: !!response.data?.id,
		customerId: response.data?.id,
		status: response.status,
	});
	
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
	const sanitizedCpf = sanitizeCpfCnpj(data.cpfCnpj);
	
	// Validar dados obrigatórios
	if (!data.cpfCnpj || sanitizedCpf.length < 11) {
		throw new AppError("CPF/CNPJ inválido ou não fornecido", 400);
	}
	
	if (!data.name || data.name.trim() === "") {
		throw new AppError("Nome é obrigatório para criar cliente no ASAAS", 400);
	}
	
	if (!data.email || data.email.trim() === "") {
		throw new AppError("Email é obrigatório para criar cliente no ASAAS", 400);
	}
	
	console.log("[asaasGetOrCreateCustomerByCpfCnpj] Buscando cliente no ASAAS:", {
		cpfCnpj: `${sanitizedCpf.substring(0, 3)}***`,
		email: data.email,
		name: data.name,
	});

	try {
		let customer = await asaasGetCustomerByCpfCnpj(data.cpfCnpj);
		
		if (customer) {
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Cliente encontrado no ASAAS:", {
				customerId: customer.id,
				customerName: customer.name,
			});
			
			// Atualizar dados do cliente
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Atualizando dados do cliente...");
			customer = await asaasUpdateCustomer(customer.id, data);
			
			// Validar se o customer tem id válido após atualização
			if (!customer?.id) {
				console.error("[asaasGetOrCreateCustomerByCpfCnpj] Cliente atualizado sem id válido:", customer);
				throw new AppError(
					"Erro ao gerar pagamento PIX: Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
					400,
				);
			}
			
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Cliente atualizado com sucesso:", {
				customerId: customer.id,
			});
			
			return customer;
		}
		
		// Se não encontrou, lançar erro para entrar no catch e criar
		throw new Error("Customer not found");
	} catch (error) {
		// Se for um AppError (erro do ASAAS), relançar
		if (error instanceof AppError) {
			console.error("[asaasGetOrCreateCustomerByCpfCnpj] AppError ao buscar/atualizar cliente:", {
				message: error.message,
				statusCode: error.statusCode,
			});
			throw error;
		}
		
		// Se não encontrou o cliente, tentar criar um novo
		console.log("[asaasGetOrCreateCustomerByCpfCnpj] Cliente não encontrado, criando novo...", {
			error: error instanceof Error ? error.message : String(error),
		});
		
		try {
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Dados para criar cliente:", {
				name: data.name,
				cpfCnpj: `${sanitizedCpf.substring(0, 3)}***`,
				email: data.email,
				phone: data.phone,
			});
			
			const newCustomer = await asaasCreateCustomer(data);
			
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Resposta da criação:", {
				hasId: !!newCustomer?.id,
				customerId: newCustomer?.id,
				customerName: newCustomer?.name,
				allKeys: newCustomer ? Object.keys(newCustomer) : [],
			});
			
			// Validar se o customer tem id válido após criação
			if (!newCustomer?.id) {
				console.error("[asaasGetOrCreateCustomerByCpfCnpj] Cliente criado sem id válido:", {
					customer: newCustomer ? JSON.stringify(newCustomer) : "null/undefined",
				});
				throw new AppError(
					"Erro ao gerar pagamento PIX: Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
					400,
				);
			}
			
			console.log("[asaasGetOrCreateCustomerByCpfCnpj] Cliente criado com sucesso:", {
				customerId: newCustomer.id,
			});
			
			return newCustomer;
		} catch (createError) {
			// Se for um AppError (erro do ASAAS), relançar
			if (createError instanceof AppError) {
				console.error("[asaasGetOrCreateCustomerByCpfCnpj] AppError ao criar cliente:", {
					message: createError.message,
					statusCode: createError.statusCode,
				});
				throw createError;
			}
			
			// Erro inesperado
			console.error("[asaasGetOrCreateCustomerByCpfCnpj] Erro inesperado ao criar cliente:", {
				error: createError instanceof Error ? createError.message : String(createError),
				stack: createError instanceof Error ? createError.stack : undefined,
			});
			throw new AppError(
				"Erro ao gerar pagamento PIX: Usuário sem customerId do ASAAS. Cadastre o cliente no ASAAS antes de assinar.",
				400,
			);
		}
	}
}
