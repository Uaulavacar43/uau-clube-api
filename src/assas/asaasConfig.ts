export interface AsaasConfig {
  apiUrl: string;
  apiKey: string;
}

export function getAsaasConfig(): AsaasConfig {
  const apiUrl: string = (process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3").trim();
  const apiKey: string = (process.env.ASAAS_API_KEY ?? "").trim();

  if (apiKey === "") {
    throw new Error("ASAAS_API_KEY não configurada nas variáveis de ambiente (ASAAS_API_KEY).");
  }

  return {
    apiUrl,
    apiKey,
  };
}
