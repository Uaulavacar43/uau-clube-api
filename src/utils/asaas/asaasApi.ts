import axios from "axios";
import { envConfig } from "../../config/envConfig";

import { handleAsaasError } from "./handleAsaasError";

const asaasApi = axios.create({
	baseURL: envConfig.ASAAS_API_URL,
	headers: {
		"Content-Type": "application/json",
		access_token: envConfig.ASAAS_API_KEY,
	},
});

asaasApi.interceptors.request.use(
	(config) => {
		console.log("REQUEST -", config.url);
		return config;
	},
	(error) => {
		console.log("REQUEST -", error.response.data);
		return handleAsaasError(error);
	},
);

asaasApi.interceptors.response.use(
	(config) => {
		return config;
	},
	(error) => {
		console.log("RESPONSE -", error.response.data);
		return handleAsaasError(error);
	},
);

export { asaasApi };
