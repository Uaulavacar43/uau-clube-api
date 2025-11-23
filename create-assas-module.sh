#!/usr/bin/env bash
set -e

mkdir -p src/assas

# 1) Config do Asaas
cat > src/assas/asaasConfig.ts <<'EOF'
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
EOF

# 2) Tipos do Asaas
cat > src/assas/asaasTypes.ts <<'EOF'
export interface AsaasCustomer {
  object: "customer";
  id: string;
  dateCreated: string;
  name: string;
  email: string | null;
  company: string | null;
  phone: string | null;
  mobilePhone: string | null;
  address: string | null;
  addressNumber: string | null;
  complement: string | null;
  province: string | null;
  postalCode: string | null;
  cpfCnpj: string | null;
  personType: string;
  deleted: boolean;
  additionalEmails: string | null;
  externalReference: string | null;
  notificationDisabled: boolean;
  observations: string | null;
  municipalInscription: string | null;
  stateInscription: string | null;
  canDelete: boolean;
  cannotBeDeletedReason: string | null;
  canEdit: boolean;
  cannotEditReason: string | null;
  city: string | null;
  cityName: string | null;
  state: string | null;
  country: string | null;
}

export interface AsaasCustomerListResponse {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasCustomer[];
}

export interface AsaasPayment {
  object: "payment";
  id: string;
  dateCreated?: string;
  customer: string;
  value: number;
  netValue?: number | null;
  originalValue?: number | null;
  billingType?: string | null;
  status: string;
  dueDate?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCode?: string | null;
  qrCode?: string | null;
  installmentNumber?: number | null;
}

export interface AsaasPaymentListResponse {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasPayment[];
}
EOF

# 3) Cliente HTTP (axios)
cat > src/assas/AsaasHttpClient.ts <<'EOF'
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

  async fetchCustomers(offset: number, limit: number): Promise<AsaasCustomerListResponse> {
    const response: AxiosResponse<AsaasCustomerListResponse> =
      await this.http.get<AsaasCustomerListResponse>("/customers", {
        params: {
          offset,
          limit,
        },
      });

    return response.data;
  }

  async fetchPayments(offset: number, limit: number): Promise<AsaasPaymentListResponse> {
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
EOF

# 4) Serviço de sincronização (User + Payment)
cat > src/assas/AsaasSyncService.ts <<'EOF'
import {
  type Payment,
  PaymentStatus,
  Role,
  type User,
  UserStatus,
} from "@prisma/client";

import prismaClient from "../config/dbConfig";
import {
  type AsaasCustomer,
  type AsaasCustomerListResponse,
  type AsaasPayment,
  type AsaasPaymentListResponse,
} from "./asaasTypes";
import { AsaasHttpClient } from "./AsaasHttpClient";

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

export class AsaasSyncService {
  private readonly httpClient: AsaasHttpClient;

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

  async sincronizarClientes(): Promise<SyncClientesResultado> {
    const limit: number = 50;
    let offset: number = 0;

    let totalProcessados: number = 0;
    let totalCriados: number = 0;
    let totalAtualizados: number = 0;

    this.clientesPorId.clear();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pagina: AsaasCustomerListResponse =
        await this.httpClient.fetchCustomers(offset, limit);

      if (pagina.data.length === 0) {
        break;
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const cliente of pagina.data) {
        this.clientesPorId.set(cliente.id, cliente);

        // eslint-disable-next-line no-await-in-loop
        const { criado, atualizado } =
          await this.criarOuAtualizarUsuarioPorCliente(cliente);

        totalProcessados += 1;
        if (criado) {
          totalCriados += 1;
        }
        if (atualizado) {
          totalAtualizados += 1;
        }
      }

      if (!pagina.hasMore) {
        break;
      }

      offset += limit;
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

    if (cpfSanitizado !== null) {
      usuarioExistente = await prismaClient.user.findUnique({
        where: {
          cpf: cpfSanitizado,
        },
      });
    }

    if (usuarioExistente === null && emailSanitizado !== null) {
      usuarioExistente = await prismaClient.user.findUnique({
        where: {
          email: emailSanitizado,
        },
      });
    }

    const telefoneFinal: string = telefoneSanitizado ?? "";
    const cpfFinal: string | null = cpfSanitizado;

    if (usuarioExistente === null) {
      const emailFinal: string =
        emailSanitizado ?? this.gerarEmailPlaceholder(cpfFinal, nome);

      const novoUsuario: User = await prismaClient.user.create({
        data: {
          name: nome,
          email: emailFinal,
          password: this.gerarSenhaPlaceholder(),
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

      // eslint-disable-next-line no-console
      console.log(
        `User criado a partir do Asaas: ${novoUsuario.name} (cpf=${novoUsuario.cpf ?? "sem cpf"}, email=${novoUsuario.email}).`,
      );

      return {
        criado: true,
        atualizado: false,
      };
    }

    await prismaClient.user.update({
      where: {
        id: usuarioExistente.id,
      },
      data: {
        name: nome,
        phone: telefoneFinal !== "" ? telefoneFinal : usuarioExistente.phone,
        cpf: cpfFinal ?? usuarioExistente.cpf,
        status: UserStatus.ACTIVE,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `User atualizado a partir do Asaas: ${usuarioExistente.name} (id=${usuarioExistente.id}).`,
    );

    return {
      criado: false,
      atualizado: true,
    };
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
    return "imported-from-asaas";
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
    const limit: number = 50;
    let offset: number = 0;

    let totalProcessados: number = 0;
    let totalCriados: number = 0;
    let totalIgnorados: number = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pagina: AsaasPaymentListResponse =
        await this.httpClient.fetchPayments(offset, limit);

      if (pagina.data.length === 0) {
        break;
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const pagamento of pagina.data) {
        // eslint-disable-next-line no-await-in-loop
        const { criado, ignorado } =
          await this.criarPagamentoParaUsuarioSeExistir(pagamento);

        totalProcessados += 1;

        if (criado) {
          totalCriados += 1;
        }

        if (ignorado) {
          totalIgnorados += 1;
        }
      }

      if (!pagina.hasMore) {
        break;
      }

      offset += limit;
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

    const clienteAsaas: AsaasCustomer | undefined =
      this.clientesPorId.get(clienteIdAsaas);

    if (clienteAsaas === undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        `Cliente Asaas ${clienteIdAsaas} não encontrado em cache ao processar pagamento ${pagamento.id}. Pagamento ignorado.`,
      );
      return {
        criado: false,
        ignorado: true,
      };
    }

    const cpfSanitizado: string | null =
      clienteAsaas.cpfCnpj !== null && clienteAsaas.cpfCnpj.trim() !== ""
        ? clienteAsaas.cpfCnpj.replace(/\D/g, "")
        : null;

    if (cpfSanitizado === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `Cliente Asaas ${clienteIdAsaas} sem CPF válido ao processar pagamento ${pagamento.id}. Pagamento ignorado.`,
      );
      return {
        criado: false,
        ignorado: true,
      };
    }

    const usuario: User | null = await prismaClient.user.findUnique({
      where: {
        cpf: cpfSanitizado,
      },
    });

    if (usuario === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `Nenhum User encontrado com CPF ${cpfSanitizado} ao processar pagamento ${pagamento.id}. Pagamento ignorado.`,
      );
      return {
        criado: false,
        ignorado: true,
      };
    }

    const existente: Payment | null = await prismaClient.payment.findFirst({
      where: {
        userId: usuario.id,
        paymentIdAsaas: pagamento.id,
      },
    });

    if (existente !== null) {
      // eslint-disable-next-line no-console
      console.log(
        `Payment já existe para userId=${usuario.id} e paymentIdAsaas=${pagamento.id}. Ignorando duplicado.`,
      );
      return {
        criado: false,
        ignorado: true,
      };
    }

    const statusFinal: PaymentStatus = this.mapearStatusPagamento(pagamento);

    const dataCriacao: Date =
      pagamento.dateCreated !== undefined && pagamento.dateCreated !== null
        ? new Date(pagamento.dateCreated)
        : new Date();

    const dataPagamento: Date =
      pagamento.paymentDate !== undefined && pagamento.paymentDate !== null
        ? new Date(pagamento.paymentDate)
        : dataCriacao;

    const valor: number = pagamento.value;

    const pixQrCode: string | null =
      pagamento.pixQrCode !== undefined && pagamento.pixQrCode !== null
        ? pagamento.pixQrCode
        : pagamento.qrCode !== undefined && pagamento.qrCode !== null
        ? pagamento.qrCode
        : null;

    const installments: number | null =
      pagamento.installmentNumber !== undefined &&
      pagamento.installmentNumber !== null
        ? pagamento.installmentNumber
        : null;

    const paymentMethodId: string | null =
      pagamento.billingType !== undefined && pagamento.billingType !== null
        ? pagamento.billingType
        : null;

    const novoPayment: Payment = await prismaClient.payment.create({
      data: {
        userId: usuario.id,
        amount: valor,
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

    // eslint-disable-next-line no-console
    console.log(
      `Payment criado para userId=${usuario.id} a partir do Asaas (paymentIdAsaas=${novoPayment.paymentIdAsaas}, valor=${novoPayment.amount}).`,
    );

    return {
      criado: true,
      ignorado: false,
    };
  }

  private mapearStatusPagamento(pagamento: AsaasPayment): PaymentStatus {
    const statusBruto: string = pagamento.status.toUpperCase();

    if (
      statusBruto === "RECEIVED" ||
      statusBruto === "CONFIRMED" ||
      statusBruto === "RECEIVED_IN_CASH" ||
      statusBruto === "RECEIVED_IN_CREDIT_CARD"
    ) {
      return PaymentStatus.PAID;
    }

    if (statusBruto === "PENDING" || statusBruto === "OVERDUE") {
      return PaymentStatus.PENDING;
    }

    if (
      statusBruto === "CANCELLED" ||
      statusBruto === "CANCELED" ||
      statusBruto === "REFUNDED" ||
      statusBruto === "CHARGEBACK_REQUESTED" ||
      statusBruto === "CHARGEBACK_DISPUTE" ||
      statusBruto === "AWAITING_CHARGEBACK_REVERSAL"
    ) {
      return PaymentStatus.CANCELED;
    }

    return PaymentStatus.PENDING;
  }

  // =========================================================
  // ORQUESTRAÇÃO GERAL
  // =========================================================

  async sincronizarTudo(): Promise<SyncCompletoResultado> {
    const clientes: SyncClientesResultado = await this.sincronizarClientes();
    const pagamentos: SyncPagamentosResultado =
      await this.sincronizarPagamentos();

    return {
      message: "Sincronização completa (clientes + pagamentos) concluída.",
      clientes,
      pagamentos,
    };
  }
}
EOF

# 5) Rotas Express
cat > src/assas/asaas.routes.ts <<'EOF'
import { Router, type Request, type Response, type NextFunction } from "express";
import { AsaasSyncService } from "./AsaasSyncService";

const router: Router = Router();
const asaasService: AsaasSyncService = new AsaasSyncService();

router.get(
  "/clientes",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const offsetParam: string | undefined = req.query.offset as string | undefined;
      const limitParam: string | undefined = req.query.limit as string | undefined;

      const offset: number = offsetParam !== undefined ? Number(offsetParam) : 0;
      const limit: number = limitParam !== undefined ? Number(limitParam) : 10;

      const resultado = await asaasService.listarClientesDiretoAsaas(
        offset,
        limit,
      );

      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

router.get(
  "/pagamentos",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const offsetParam: string | undefined = req.query.offset as string | undefined;
      const limitParam: string | undefined = req.query.limit as string | undefined;

      const offset: number = offsetParam !== undefined ? Number(offsetParam) : 0;
      const limit: number = limitParam !== undefined ? Number(limitParam) : 10;

      const resultado = await asaasService.listarPagamentosDiretoAsaas(
        offset,
        limit,
      );

      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

router.post(
  "/sincronizar",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const resultado = await asaasService.sincronizarTudo();
      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  },
);

export default router;
EOF

# 6) Script standalone para rodar a sincronização
cat > src/assas/sync-asaas.ts <<'EOF'
import "dotenv/config";
import { AsaasSyncService } from "./AsaasSyncService";
import prismaClient from "../config/dbConfig";

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("🚀 Iniciando sincronização Asaas → Postgres (Google Cloud)...");

  const service: AsaasSyncService = new AsaasSyncService();

  try {
    const resultado = await service.sincronizarTudo();
    // eslint-disable-next-line no-console
    console.log("✅ Resultado da sincronização:", JSON.stringify(resultado));
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.error("❌ Erro durante sincronização:", erro);
  } finally {
    await prismaClient.$disconnect();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  }
}

main().catch((erro: unknown) => {
  // eslint-disable-next-line no-console
  console.error("❌ Erro não tratado no main:", erro);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
EOF

echo "Arquivos do módulo Asaas criados em src/assas."
