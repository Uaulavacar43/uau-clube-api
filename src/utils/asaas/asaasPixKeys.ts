import { asaasApi } from "./asaasApi";
import {
	type ASAASCreatePixKeyDTO,
	type ASAASPixKeyListResponse,
	type ASAASPixKeyResponse,
	ASAASPixKeyTypeEnum,
	type ASAASPixTransferDTO,
	type ASAASPixTransferResponse,
} from "./types/pixKeyTypes";

/**
 * Cria uma nova chave PIX na plataforma ASAAS
 * Por padrão, cria uma chave aleatória (EVP)
 */
export async function asaasCreatePixKey(
	data: ASAASCreatePixKeyDTO,
): Promise<ASAASPixKeyResponse> {
	const response = await asaasApi.post("/pix/addressKeys", data);
	return response.data;
}

/**
 * Recupera uma chave PIX pelo seu ID na plataforma ASAAS
 */
export async function asaasGetPixKey(
	pixKeyId: string,
): Promise<ASAASPixKeyResponse> {
	const response = await asaasApi.get(`/pix/addressKeys/${pixKeyId}`);
	return response.data;
}

/**
 * Lista todas as chaves PIX da conta na plataforma ASAAS
 */
export async function asaasListPixKeys(
	offset: number = 0,
	limit: number = 10,
): Promise<ASAASPixKeyListResponse> {
	const response = await asaasApi.get("/pix/addressKeys", {
		params: {
			offset,
			limit,
		},
	});
	return response.data;
}

/**
 * Remove uma chave PIX da plataforma ASAAS
 */
export async function asaasRemovePixKey(
	pixKeyId: string,
): Promise<ASAASPixKeyResponse> {
	const response = await asaasApi.delete(`/pix/addressKeys/${pixKeyId}`);
	return response.data;
}

/**
 * Realiza uma transferência PIX para uma chave PIX ou dados bancários
 */
export async function asaasPixTransfer(
	data: ASAASPixTransferDTO,
): Promise<ASAASPixTransferResponse> {
	const response = await asaasApi.post("/pix/transfers", data);
	return response.data;
}

/**
 * Recupera os detalhes de uma transferência PIX pelo ID
 */
export async function asaasGetPixTransfer(
	transferId: string,
): Promise<ASAASPixTransferResponse> {
	const response = await asaasApi.get(`/pix/transfers/${transferId}`);
	return response.data;
}

/**
 * Cancela uma transferência PIX agendada
 */
export async function asaasCancelPixTransfer(
	transferId: string,
): Promise<ASAASPixTransferResponse> {
	const response = await asaasApi.delete(`/pix/transfers/${transferId}`);
	return response.data;
}

/**
 * Lista todas as transferências PIX realizadas
 */
export async function asaasListPixTransfers(
	offset: number = 0,
	limit: number = 10,
): Promise<{
	data: ASAASPixTransferResponse[];
	totalCount: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}> {
	const response = await asaasApi.get("/pix/transfers", {
		params: {
			offset,
			limit,
		},
	});
	return response.data;
}

/**
 * Obtém uma chave PIX aleatória ou cria uma nova se não existir
 * Retorna a primeira chave ativa encontrada ou cria uma nova
 */
export async function asaasGetOrCreateRandomPixKey(): Promise<ASAASPixKeyResponse> {
	// Tenta obter as chaves existentes
	const existingKeys = await asaasListPixKeys();

	// Filtra apenas chaves ativas e aleatórias (EVP)
	const activeRandomKeys = existingKeys.data.filter(
		(key) => key.status === "ACTIVE" && key.type === "EVP",
	);

	// Se encontrar uma chave ativa, retorna a primeira
	if (activeRandomKeys.length > 0) {
		return activeRandomKeys[0];
	}

	// Caso contrário, cria uma nova chave aleatória
	return await asaasCreatePixKey({ type: ASAASPixKeyTypeEnum.EVP });
}
