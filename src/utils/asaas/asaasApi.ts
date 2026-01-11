import axios from "axios";
import https from "https";
import { envConfig } from "../../config/envConfig";

import { handleAsaasError } from "./handleAsaasError";

// Validação das variáveis de ambiente do ASAAS
if (!envConfig.ASAAS_API_URL || !envConfig.ASAAS_API_KEY) {
	console.error("[asaasApi] Variáveis de ambiente do ASAAS não configuradas:", {
		hasApiUrl: !!envConfig.ASAAS_API_URL,
		hasApiKey: !!envConfig.ASAAS_API_KEY,
		apiUrl: envConfig.ASAAS_API_URL ? "***" : "NÃO DEFINIDA",
	});
}

// Configuração do HTTPS Agent para lidar com certificados SSL
// Em desenvolvimento, permite certificados autoassinados (útil para proxies corporativos)
// Em produção, mantém a validação de certificados por segurança
// Para desabilitar a validação em produção, defina ASAAS_REJECT_UNAUTHORIZED=false no .env
const isDevelopment = envConfig.NODE_ENV === "development";
const rejectUnauthorizedEnv = process.env.ASAAS_REJECT_UNAUTHORIZED;

// Se a variável estiver explicitamente definida como "false", não rejeitar
// Se estiver em desenvolvimento, não rejeitar por padrão
// Caso contrário, rejeitar (produção com validação ativa)
const shouldRejectUnauthorized = rejectUnauthorizedEnv === "false" 
	? false 
	: isDevelopment 
		? false 
		: true;

const httpsAgent = new https.Agent({
	rejectUnauthorized: shouldRejectUnauthorized,
});

if (!shouldRejectUnauthorized) {
	console.warn(
		"[asaasApi] SSL certificate validation está desabilitada.",
		isDevelopment 
			? "Isso é seguro em desenvolvimento."
			: "Certifique-se de que isso é necessário (ex: proxy corporativo).",
	);
}

const asaasApi = axios.create({
	baseURL: envConfig.ASAAS_API_URL,
	headers: {
		"Content-Type": "application/json",
		access_token: envConfig.ASAAS_API_KEY,
	},
	timeout: 30000, // 30 segundos de timeout
	httpsAgent: httpsAgent, // Configuração do agente HTTPS
});

asaasApi.interceptors.request.use(
	(config) => {
		console.log("[asaasApi] REQUEST:", {
			method: config.method?.toUpperCase(),
			url: config.url,
			baseURL: config.baseURL,
			hasAccessToken: !!config.headers?.access_token,
		});
		return config;
	},
	(error) => {
		console.error("[asaasApi] REQUEST ERROR:", {
			message: error.message,
			response: error.response?.data,
		});
		handleAsaasError(error);
		return Promise.reject(error);
	},
);

asaasApi.interceptors.response.use(
	(response) => {
		console.log("[asaasApi] RESPONSE:", {
			status: response.status,
			url: response.config.url,
		});
		return response;
	},
	(error) => {
		console.error("[asaasApi] RESPONSE ERROR:", {
			url: error.config?.url,
			status: error.response?.status,
			statusText: error.response?.statusText,
			data: error.response?.data,
			code: error.code,
			message: error.message,
		});
		handleAsaasError(error);
		return Promise.reject(error);
	},
);

export { asaasApi };
