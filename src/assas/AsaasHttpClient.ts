// src/assas/AsaasHttpClient.ts
import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { getAsaasConfig } from "./asaasConfig";
import {
    type AsaasCustomerListResponse,
    type AsaasPaymentListResponse,
} from "./asaasTypes";

export class AsaasHttpClient {
    private readonly http: AxiosInstance;

    constructor() {
        const config = getAsaasConfig();

        this.http = axios.create({
            baseURL: config.apiUrl,
            headers: {
                access_token: config.apiKey,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
    }

    async fetchCustomers(
        offset: number,
        limit: number,
    ): Promise<AsaasCustomerListResponse> {
        const response: AxiosResponse<AsaasCustomerListResponse> =
            await this.http.get<AsaasCustomerListResponse>("/customers", {
                params: {
                    offset,
                    limit,
                },
            });

        return response.data;
    }

    async fetchPayments(
        offset: number,
        limit: number,
    ): Promise<AsaasPaymentListResponse> {
        const response: AxiosResponse<AsaasPaymentListResponse> =
            await this.http.get<AsaasPaymentListResponse>("/payments", {
                params: {
                    offset,
                    limit,
                },
            });

        return response.data;
    }
}
