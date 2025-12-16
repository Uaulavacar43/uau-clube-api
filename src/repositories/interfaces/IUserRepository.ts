import type { User } from "../../entities/User";

export interface IFilterGetAll {
	page: number;
	pageSize: number;
	roles?: ("USER" | "ADMIN" | "MANAGER")[];
	searchTerm?: string;
	orderBy?: "name" | "email" | "createdAt" | "updatedAt" | "lastPaymentDate";
	orderDirection?: "asc" | "desc";
	includePlans?: boolean;
}

/**
 * Mesmos valores do enum ReferralSource no Prisma.
 * (Mantido aqui como type para não depender de Prisma no domínio.)
 */
export type ReferralSource = "LINK" | "COUPON" | "LANDING" | "UNKNOWN";

/**
 * Payload mínimo para registrar auditoria da indicação (tabela UserReferral no Prisma).
 * Esse registro é o “comprovante” da origem: link/cupom/landing + antifraude básica.
 */
export interface CreateUserReferralInput {
	referrerId: number;
	referredId: number;
	source: ReferralSource;

	deviceId?: string | null;
	ip?: string | null;
	userAgent?: string | null;
	meta?: unknown;
}

/**
 * Estrutura padronizada para capturar contexto do request (antifraude leve / auditoria).
 * Você pode montar isso no Controller (req.ip, user-agent, deviceId do header/app etc.).
 */
export interface ReferralRequestContext {
	source: ReferralSource;
	deviceId?: string | null;
	ip?: string | null;
	userAgent?: string | null;
	meta?: unknown;
}

/**
 * Resultado do attachReferralOnSignup:
 * - attached=true se foi vinculado e auditado
 * - reason para logging / debugging
 */
export interface AttachReferralResult {
	attached: boolean;
	reason?:
		| "NO_CODE"
		| "INVALID_CODE"
		| "REFERRER_NOT_FOUND"
		| "REFERRER_INACTIVE"
		| "REFERRER_DELETED"
		| "SELF_REFERRAL_BLOCKED"
		| "ALREADY_HAS_REFERRER"
		| "ALREADY_HAS_REFERRAL_AUDIT"
		| "ATTACHED";
	referrerId?: number | null;
	referredId: number;
	referralCodeUsed?: string | null;
}

export interface IUserRepository {
	// ---------------------------------------------------------------------
	// Básicos
	// ---------------------------------------------------------------------
	findByEmail(email: string, withIsDeleted?: boolean): Promise<User | null>;
	findById(id: number, withIsDeleted?: boolean): Promise<User | null>;
	create(user: User): Promise<User>;
	update(userId: number, data: Partial<User>): Promise<User>;
	delete(userId: number): Promise<void>;
	findAll(): Promise<User[]>;

	findByCpf(cpf: string | null, withIsDeleted?: boolean): Promise<User | null>;
	findByLicensePlate(licensePlate: string): Promise<any | null>;

	findAllByRole(
		role: "ADMIN" | "USER" | "MANAGER",
		skip: number,
		take: number,
	): Promise<{ users: User[]; total: number }>;

	countAllUsers(): Promise<number>;
	countActiveSubscribers(): Promise<number>;

	findAllWithPagination(
		filters: IFilterGetAll,
	): Promise<{ users: User[]; total: number }>;

	// ---------------------------------------------------------------------
	// Firebase Tokens
	// ---------------------------------------------------------------------
	getFirebaseTokensByType(type: "USER" | "MANAGER" | "ALL"): Promise<string[]>;
	getUsersWithPendingPayments(): Promise<User[]>;

	findUsersWithExpiringSubscriptions(): Promise<
		{ user: User; expiryDate: Date | null }[]
	>;

	addFirebaseToken(userId: number, firebaseToken: string): Promise<void>;
	removeFirebaseToken(userId: number, firebaseToken: string): Promise<void>;
	getFirebaseTokensById(userId: number): Promise<string[]>;

	// ---------------------------------------------------------------------
	// Referral (Fase 1/2/3) — suporte ao módulo referrals + cadastro
	// ---------------------------------------------------------------------

	/**
	 * Busca usuário pelo referralCode.
	 * Usado no validate endpoint e no cadastro (para resolver referrer).
	 */
	findByReferralCode(
		referralCode: string,
		withIsDeleted?: boolean,
	): Promise<User | null>;

	/**
	 * Atualiza o referralCode do usuário.
	 * Útil para gerar no register, corrigir colisão, regenerar.
	 */
	updateReferralCode(userId: number, referralCode: string): Promise<User>;

	/**
	 * Anexa o referrerId no User (vínculo direto - nível 1).
	 * É o atalho de leitura rápida pra rede (User.referrerId).
	 */
	updateReferrerId(userId: number, referrerId: number | null): Promise<User>;

	/**
	 * Cria o registro formal UserReferral (auditoria / antifraude / origem).
	 * Deve ser chamado junto com updateReferrerId().
	 */
	createUserReferral(input: CreateUserReferralInput): Promise<void>;

	/**
	 * Valida se o usuário já possui registro formal de indicação (UserReferral) como "referred".
	 * Evita troca de referrer após o cadastro.
	 */
	hasReferralReceived(referredId: number): Promise<boolean>;

	/**
	 * Verifica se o user já tem referrerId setado.
	 * (Útil para bloquear rebind em fluxos de update.)
	 */
	hasReferrerAttached(referredId: number): Promise<boolean>;

	/**
	 * Operação “atômica” (idealmente via transação no repositório):
	 * - resolve o referrer pelo code
	 * - valida regras (não permite self-referral, referrer inativo/deletado etc.)
	 * - grava User.referrerId
	 * - grava UserReferral (auditoria)
	 *
	 * Observação: Você pode chamar isso no AuthService.register após criar o usuário,
	 * ou chamar ANTES se seu create já aceitar referrerId (mas a auditoria ainda precisa).
	 */
	attachReferralOnSignup(params: {
		referredId: number;
		referralCode: string;
		context: ReferralRequestContext;
	}): Promise<AttachReferralResult>;
}
