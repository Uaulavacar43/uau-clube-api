/**
 * Tipos de chaves PIX disponíveis no Asaas
 */
export enum ASAASPixKeyTypeEnum {
	CPF = "CPF",
	CNPJ = "CNPJ",
	EMAIL = "EMAIL",
	PHONE = "PHONE",
	EVP = "EVP", // Chave aleatória
}

/**
 * Status possíveis de uma chave PIX no Asaas
 */
export enum ASAASPixKeyStatusEnum {
	ACTIVE = "ACTIVE",
	AWAITING_ACTIVATION = "AWAITING_ACTIVATION",
	REMOVED = "REMOVED",
}

/**
 * DTO para criação de uma chave PIX no Asaas
 */
export interface ASAASCreatePixKeyDTO {
	type: ASAASPixKeyTypeEnum;
	key?: string; // Opcional, apenas para CPF, CNPJ, EMAIL e PHONE
}

/**
 * Resposta da criação ou consulta de uma chave PIX no Asaas
 */
export interface ASAASPixKeyResponse {
	id: string;
	key: string;
	type: ASAASPixKeyTypeEnum;
	status: ASAASPixKeyStatusEnum;
	createdAt: string;
	deletedAt?: string;
}

/**
 * Resposta da listagem de chaves PIX no Asaas
 */
export interface ASAASPixKeyListResponse {
	data: ASAASPixKeyResponse[];
	totalCount: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}

/**
 * Interface para transferência PIX
 */
export interface ASAASPixTransferDTO {
	value: number;
	description?: string;
	pixAddressKey?: string; // Chave PIX do destinatário
	pixAddressKeyType?: ASAASPixKeyTypeEnum; // Tipo da chave PIX do destinatário
	bankAccount?: {
		bank: {
			code: string;
		};
		ownerName: string;
		ownerBirthDate?: string;
		cpfCnpj: string;
		agency: string;
		account: string;
		accountDigit: string;
		pixAddressKey?: string;
	};
	scheduleDate?: string; // Data para agendamento (YYYY-MM-DD)
}

/**
 * Resposta de uma transferência PIX
 */
export interface ASAASPixTransferResponse {
	id: string;
	value: number;
	description?: string;
	status: string;
	transferFee: number;
	effectiveDate: string;
	scheduleDate?: string;
	createdAt: string;
	pixAddressKey?: string;
	pixAddressKeyType?: ASAASPixKeyTypeEnum;
	bankAccount?: {
		bank: {
			code: string;
			name: string;
		};
		ownerName: string;
		ownerBirthDate?: string;
		cpfCnpj: string;
		agency: string;
		account: string;
		accountDigit: string;
		pixAddressKey?: string;
	};
}
