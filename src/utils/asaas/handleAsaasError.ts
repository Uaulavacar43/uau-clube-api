import { isAxiosError } from "axios";
import { AppError } from "../../error/AppError";

interface AsaasError {
	code: string;
	description: string;
}

const asaasErrorMessages: Record<string, string> = {
	// Erros de cartão de crédito
	invalid_number: "Número do cartão inválido",
	invalid_expiry_month: "Mês de expiração inválido",
	invalid_expiry_year: "Ano de expiração inválido",
	invalid_ccv: "Código de segurança inválido",
	expired_card: "Cartão expirado",
	card_declined: "Cartão recusado",
	insufficient_funds: "Saldo insuficiente",
	credit_card_processing_failure: "Falha no processamento do cartão",

	// Erros de cliente
	invalid_cpf: "CPF inválido",
	invalid_cnpj: "CNPJ inválido",
	invalid_phone: "Telefone inválido",
	invalid_email: "Email inválido",
	invalid_zipcode: "CEP inválido",
	customer_not_found: "Cliente não encontrado",

	// Erros de assinatura
	subscription_not_found: "Assinatura não encontrada",
	subscription_already_cancelled: "Assinatura já cancelada",
	subscription_already_deleted: "Assinatura já deletada",
	subscription_already_inactive: "Assinatura já inativa",

	// Erros de pagamento
	payment_not_found: "Pagamento não encontrado",
	payment_already_cancelled: "Pagamento já cancelado",
	payment_already_deleted: "Pagamento já deletado",
	payment_already_confirmed: "Pagamento já confirmado",
	payment_link_already_paid: "Link de pagamento já foi pago",

	// Erros gerais
	invalid_api_key: "Chave de API inválida",
	rate_limit_exceeded: "Limite de requisições excedido",
	internal_server_error: "Erro interno do servidor ASAAS",
	service_unavailable: "Serviço ASAAS indisponível",
};

export function handleAsaasError(error: unknown): AppError {
	if (isAxiosError(error)) {
		// Log detalhado do erro para debug
		console.error("[handleAsaasError] Erro do Axios:", {
			url: error.config?.url,
			method: error.config?.method,
			status: error.response?.status,
			statusText: error.response?.statusText,
			data: error.response?.data,
			code: error.code,
			message: error.message,
			hasResponse: !!error.response,
			hasRequest: !!error.request,
		});

		// Verifica se há erros estruturados do ASAAS
		const errors = error.response?.data?.errors as AsaasError[];

		if (errors && errors.length > 0) {
			const messages = errors.map((err) => {
				// Tenta encontrar uma mensagem personalizada para o código de erro
				const customMessage = asaasErrorMessages[err.code];
				// Se não encontrar, usa a descrição original do ASAAS
				return customMessage || err.description;
			});

			// Junta todas as mensagens de erro em uma única string
			const errorMessage = messages.join("\n");

			// Define o status HTTP apropriado baseado no tipo de erro
			let statusCode = 500;
			if (error.response?.status) {
				statusCode = error.response.status;
			} else if (errors.some((err) => err.code.includes("not_found"))) {
				statusCode = 404;
			} else if (errors.some((err) => err.code.includes("invalid"))) {
				statusCode = 400;
			}

			throw new AppError(errorMessage, statusCode);
		}

		// Tratamento específico para diferentes tipos de erro do Axios
		if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
			console.error("[handleAsaasError] Erro de conexão com ASAAS:", {
				code: error.code,
				url: error.config?.url,
				baseURL: error.config?.baseURL,
			});
			throw new AppError(
				"Não foi possível conectar ao serviço ASAAS. Verifique se a URL da API está correta e se o serviço está disponível.",
				503,
			);
		}

		// Tratamento específico para erros de certificado SSL
		if (
			error.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
			error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
			error.message?.includes("self signed certificate") ||
			error.message?.includes("certificate")
		) {
			console.error("[handleAsaasError] Erro de certificado SSL:", {
				code: error.code,
				message: error.message,
				url: error.config?.url,
			});
			throw new AppError(
				"Erro de certificado SSL ao conectar com o ASAAS. Se você está em um ambiente corporativo com proxy, configure a variável ASAAS_REJECT_UNAUTHORIZED=false no .env",
				500,
			);
		}

		if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
			console.error("[handleAsaasError] Timeout na requisição ao ASAAS");
			throw new AppError(
				"Tempo de conexão com o ASAAS esgotado. Tente novamente mais tarde.",
				504,
			);
		}

		if (error.response?.status === 401 || error.response?.status === 403) {
			console.error("[handleAsaasError] Erro de autenticação com ASAAS:", {
				status: error.response.status,
				data: error.response.data,
			});
			throw new AppError(
				"Erro de autenticação com o ASAAS. Verifique se a chave de API está correta.",
				401,
			);
		}

		// Fallback para erros do Axios sem a estrutura padrão do ASAAS
		const errorMessage = error.response?.data?.message || 
			error.response?.data?.error ||
			(error.code ? `Erro de conexão: ${error.code}` : "Erro ao comunicar com o ASAAS");
		
		console.error("[handleAsaasError] Erro genérico do ASAAS:", {
			message: errorMessage,
			status: error.response?.status || 500,
			responseData: error.response?.data,
		});

		throw new AppError(
			errorMessage,
			error.response?.status || 500,
		);
	}

	// Fallback para erros não relacionados ao Axios
	if (error instanceof Error) {
		console.error("[handleAsaasError] Erro não-Axios:", {
			message: error.message,
			stack: error.stack,
		});
		throw new AppError(error.message, 500);
	}

	console.error("[handleAsaasError] Erro desconhecido:", error);
	throw new AppError("Erro inesperado ao processar requisição ASAAS", 500);
}
