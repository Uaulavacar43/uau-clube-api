import { randomUUID } from "crypto";
import {
    type Payment,
    PaymentStatus,
    Role,
    type User,
    UserStatus,
} from "@prisma/client";

import prismaClient from "../config/dbConfig";
import { hashPassword } from "../utils/password";
import {
    type AsaasCustomer,
    type AsaasCustomerListResponse,
    type AsaasPayment,
    type AsaasPaymentListResponse,
} from "./asaasTypes";
import { AsaasHttpClient } from "./AsaasHttpClient";

// =========================================================
// TIPOS DE RETORNO
// =========================================================

export interface SyncClientesResultado {
    totalProcessados: number;
    totalCriados: number;
    totalAtualizados: number;
}

export interface SyncPagamentosResultado {
    totalProcessados: number;
    totalCriados: number;
    totalIgnorados: number;
}

export interface SyncCompletoResultado {
    message: string;
    clientes: SyncClientesResultado;
    pagamentos: SyncPagamentosResultado;
}

// =========================================================
// HELPER PARA PAUSA (RATE LIMIT)
// =========================================================
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AsaasSyncService {
    private readonly httpClient: AsaasHttpClient;

    // Cache local para vincular pagamentos aos clientes sem bater no banco toda hora
    private readonly clientesPorId: Map<string, AsaasCustomer>;

    constructor(httpClient?: AsaasHttpClient) {
        this.httpClient = httpClient ?? new AsaasHttpClient();
        this.clientesPorId = new Map<string, AsaasCustomer>();
    }

    // =========================================================
    // CLIENTES
    // =========================================================

    async listarClientesDiretoAsaas(
        offset: number,
        limit: number,
    ): Promise<AsaasCustomerListResponse> {
        return this.httpClient.fetchCustomers(offset, limit);
    }

    /**
     * Sincroniza TODOS os clientes.
     * Estratégia: Loop infinito até 'hasMore' ser false.
     * Pausa de 2s entre páginas.
     */
    async sincronizarClientes(): Promise<SyncClientesResultado> {
        const limit: number = 100; // Máximo permitido pelo Asaas
        let offset: number = 0;
        let paginaAtual: number = 1;

        let totalProcessados: number = 0;
        let totalCriados: number = 0;
        let totalAtualizados: number = 0;

        let totalCountApi: number | null = null;
        let hasMore: boolean = true;

        console.log(`[SYNC CLIENTES] Iniciando varredura completa. Limit por pág: ${limit}`);

        this.clientesPorId.clear();

        while (hasMore) {
            try {
                // Busca a página
                const response: AsaasCustomerListResponse =
                    await this.httpClient.fetchCustomers(offset, limit);

                // Atualiza controle
                hasMore = response.hasMore;
                if (totalCountApi === null) totalCountApi = response.totalCount;

                const quantidadeNaPagina = response.data.length;

                console.log(
                    `[SYNC CLIENTES] Pág ${paginaAtual} | Offset ${offset} | Encontrados: ${quantidadeNaPagina} | Total API: ${totalCountApi} | Mais páginas? ${hasMore ? "SIM" : "NÃO"}`
                );

                if (quantidadeNaPagina === 0) {
                    console.warn(`[SYNC CLIENTES] Atenção: Página vazia retornada. Encerrando loop de clientes.`);
                    break;
                }

                // Processa cada cliente da página
                for (const cliente of response.data) {
                    // Guarda em cache para usar nos pagamentos depois
                    this.clientesPorId.set(cliente.id, cliente);

                    const { criado, atualizado } =
                        await this.criarOuAtualizarUsuarioPorCliente(cliente);

                    totalProcessados++;
                    if (criado) totalCriados++;
                    if (atualizado) totalAtualizados++;
                }

                // Prepara próxima página
                offset += limit;
                paginaAtual++;

                // PAUSA PROGRAMADA (Evita Rate Limit 429)
                if (hasMore) {
                    // console.log(`[SYNC CLIENTES] Aguardando 2s para próxima página...`);
                    await delay(2000);
                }

            } catch (error) {
                console.error(`[SYNC CLIENTES] Erro fatal na página ${paginaAtual} (offset ${offset}):`, error);
                // Opcional: break ou throw. Aqui vamos parar para evitar loop infinito de erro.
                throw error;
            }
        }

        return {
            totalProcessados,
            totalCriados,
            totalAtualizados,
        };
    }

    private async criarOuAtualizarUsuarioPorCliente(
        cliente: AsaasCustomer,
    ): Promise<{ criado: boolean; atualizado: boolean }> {
        const nome: string = cliente.name;

        const emailSanitizado: string | null =
            cliente.email !== null && cliente.email.trim() !== ""
                ? cliente.email.trim()
                : null;

        const telefoneSanitizado: string | null =
            cliente.mobilePhone !== null && cliente.mobilePhone.trim() !== ""
                ? cliente.mobilePhone.trim()
                : cliente.phone !== null && cliente.phone.trim() !== ""
                    ? cliente.phone.trim()
                    : null;

        const cpfSanitizado: string | null =
            cliente.cpfCnpj !== null && cliente.cpfCnpj.trim() !== ""
                ? cliente.cpfCnpj.replace(/\D/g, "")
                : null;

        let usuarioExistente: User | null = null;

        // 1. Tenta achar por CPF
        if (cpfSanitizado !== null) {
            usuarioExistente = await prismaClient.user.findUnique({
                where: { cpf: cpfSanitizado },
            });
        }

        // 2. Tenta achar por Email se não achou por CPF
        if (usuarioExistente === null && emailSanitizado !== null) {
            usuarioExistente = await prismaClient.user.findUnique({
                where: { email: emailSanitizado },
            });
        }

        const telefoneFinal: string = telefoneSanitizado ?? "";
        const cpfFinal: string | null = cpfSanitizado;

        // CRIAÇÃO
        if (usuarioExistente === null) {
            const emailFinal: string =
                emailSanitizado ?? this.gerarEmailPlaceholder(cpfFinal, nome);

            const senhaTemporaria: string = this.gerarSenhaPlaceholder();
            const senhaHash: string = await hashPassword(senhaTemporaria);

            const novoUsuario: User = await prismaClient.user.create({
                data: {
                    name: nome,
                    email: emailFinal,
                    password: senhaHash,
                    phone: telefoneFinal,
                    cpf: cpfFinal,
                    role: Role.USER,
                    status: UserStatus.ACTIVE,
                    profileImageUrl: null,
                    otp: null,
                    firebaseTokens: [],
                    deletedAt: null,
                },
            });

            // Log discreto para não poluir
            // console.log(`> Criado: ${novoUsuario.name}`);

            return { criado: true, atualizado: false };
        }

        // ATUALIZAÇÃO
        await prismaClient.user.update({
            where: { id: usuarioExistente.id },
            data: {
                name: nome,
                phone: telefoneFinal !== "" ? telefoneFinal : usuarioExistente.phone,
                cpf: cpfFinal ?? usuarioExistente.cpf,
                status: UserStatus.ACTIVE, // Reativa se estiver inativo
            },
        });

        return { criado: false, atualizado: true };
    }

    private gerarEmailPlaceholder(cpf: string | null, nome: string): string {
        const base: string =
            cpf !== null && cpf !== ""
                ? cpf
                : nome
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "cliente";

        return `${base}@placeholder.uau`;
    }

    private gerarSenhaPlaceholder(): string {
        return randomUUID();
    }

    // =========================================================
    // PAGAMENTOS
    // =========================================================

    async listarPagamentosDiretoAsaas(
        offset: number,
        limit: number,
    ): Promise<AsaasPaymentListResponse> {
        return this.httpClient.fetchPayments(offset, limit);
    }

    async sincronizarPagamentos(): Promise<SyncPagamentosResultado> {
        const limit: number = 100; // Máximo
        let offset: number = 0;
        let paginaAtual: number = 1;

        let totalProcessados: number = 0;
        let totalCriados: number = 0;
        let totalIgnorados: number = 0;

        let totalCountApi: number | null = null;
        let hasMore: boolean = true;

        console.log(`[SYNC PAGAMENTOS] Iniciando varredura de cobranças. Limit por pág: ${limit}`);

        while (hasMore) {
            try {
                const response: AsaasPaymentListResponse =
                    await this.httpClient.fetchPayments(offset, limit);

                hasMore = response.hasMore;
                if (totalCountApi === null) totalCountApi = response.totalCount;

                const quantidadeNaPagina = response.data.length;

                console.log(
                    `[SYNC PAGAMENTOS] Pág ${paginaAtual} | Offset ${offset} | Encontrados: ${quantidadeNaPagina} | Total API: ${totalCountApi} | Mais páginas? ${hasMore ? "SIM" : "NÃO"}`
                );

                if (quantidadeNaPagina === 0) {
                    console.warn(`[SYNC PAGAMENTOS] Página vazia. Encerrando.`);
                    break;
                }

                for (const pagamento of response.data) {
                    const { criado, ignorado } =
                        await this.criarPagamentoParaUsuarioSeExistir(pagamento);

                    totalProcessados++;
                    if (criado) totalCriados++;
                    if (ignorado) totalIgnorados++;
                }

                offset += limit;
                paginaAtual++;

                // PAUSA PROGRAMADA
                if (hasMore) {
                    await delay(2000);
                }

            } catch (error) {
                console.error(`[SYNC PAGAMENTOS] Erro na página ${paginaAtual}:`, error);
                throw error;
            }
        }

        return {
            totalProcessados,
            totalCriados,
            totalIgnorados,
        };
    }

    private async criarPagamentoParaUsuarioSeExistir(
        pagamento: AsaasPayment,
    ): Promise<{ criado: boolean; ignorado: boolean }> {
        const clienteIdAsaas: string = pagamento.customer;

        // Busca do cache local populado no passo anterior
        const clienteAsaas: AsaasCustomer | undefined =
            this.clientesPorId.get(clienteIdAsaas);

        if (clienteAsaas === undefined) {
            // Se não está no cache, é porque não baixamos esse cliente ou ele foi excluído no Asaas
            return { criado: false, ignorado: true };
        }

        const cpfSanitizado: string | null =
            clienteAsaas.cpfCnpj !== null && clienteAsaas.cpfCnpj.trim() !== ""
                ? clienteAsaas.cpfCnpj.replace(/\D/g, "")
                : null;

        if (cpfSanitizado === null) {
            return { criado: false, ignorado: true };
        }

        // Busca o usuário no DB (que acabou de ser sincronizado)
        const usuario: User | null = await prismaClient.user.findUnique({
            where: { cpf: cpfSanitizado },
        });

        if (usuario === null) {
            return { criado: false, ignorado: true };
        }

        // Verifica duplicidade do pagamento
        const existente: Payment | null = await prismaClient.payment.findFirst({
            where: {
                userId: usuario.id,
                paymentIdAsaas: pagamento.id,
            },
        });

        if (existente !== null) {
            return { criado: false, ignorado: true };
        }

        const statusFinal: PaymentStatus = this.mapearStatusPagamento(pagamento);

        const dataCriacao: Date =
            pagamento.dateCreated ? new Date(pagamento.dateCreated) : new Date();

        const dataPagamento: Date =
            pagamento.paymentDate ? new Date(pagamento.paymentDate) : dataCriacao;

        // Tratamento seguro de campos opcionais
        const pixQrCode: string | null =
            pagamento.pixQrCode ?? pagamento.qrCode ?? null;

        const installments: number | null = pagamento.installmentNumber ?? null;
        const paymentMethodId: string | null = pagamento.billingType ?? null;

        const novoPayment = await prismaClient.payment.create({
            data: {
                userId: usuario.id,
                amount: pagamento.value,
                paymentDate: dataPagamento,
                status: statusFinal,
                paymentMethodId,
                planId: null,
                paymentIdAsaas: pagamento.id,
                couponId: null,
                pixPayload: null,
                pixQrCode,
                installments,
            },
        });

        return { criado: true, ignorado: false };
    }

    private mapearStatusPagamento(pagamento: AsaasPayment): PaymentStatus {
        const statusBruto: string = pagamento.status.toUpperCase();

        const statusPagos = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "RECEIVED_IN_CREDIT_CARD"];
        const statusCancelados = ["CANCELLED", "CANCELED", "REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"];

        if (statusPagos.includes(statusBruto)) return PaymentStatus.PAID;
        if (statusCancelados.includes(statusBruto)) return PaymentStatus.CANCELED;

        return PaymentStatus.PENDING;
    }

    // =========================================================
    // ORQUESTRAÇÃO GERAL
    // =========================================================

    async sincronizarTudo(): Promise<SyncCompletoResultado> {
        console.log("========================================");
        console.log("PASSO 1: Sincronizando Usuários...");
        console.log("========================================");
        const clientes: SyncClientesResultado = await this.sincronizarClientes();

        console.log("\n========================================");
        console.log(`PASSO 1 CONCLUÍDO. Cache com ${this.clientesPorId.size} clientes.`);
        console.log("PASSO 2: Sincronizando Pagamentos...");
        console.log("========================================");

        const pagamentos: SyncPagamentosResultado = await this.sincronizarPagamentos();

        return {
            message: "Sincronização completa (clientes + pagamentos) concluída.",
            clientes,
            pagamentos,
        };
    }
}