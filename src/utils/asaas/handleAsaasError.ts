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
		console.log(error.response?.data);
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

		// Fallback para erros do Axios sem a estrutura padrão do ASAAS
		throw new AppError(
			error.response?.data?.message || "Erro ao comunicar com o ASAAS",
			error.response?.status || 500,
		);
	}

	// Fallback para erros não relacionados ao Axios
	if (error instanceof Error) {
		throw new AppError(error.message, 500);
	}

	throw new AppError("Erro inesperado ao processar requisição ASAAS", 500);
}
