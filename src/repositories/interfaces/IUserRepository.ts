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

export interface IUserRepository {
	findByEmail(email: string, withIsDeleted?: boolean): Promise<User | null>;
	findById(id: number): Promise<any | null>;
	create(user: User): Promise<User>;
	update(userId: number, data: Partial<User>): Promise<User>;
	delete(userId: number): Promise<void>;
	findAll(): Promise<User[]>;
	findByCpf(cpf: string | null, withIsDeleted?: boolean): Promise<User | null>; // Buscar por CPF
	findByLicensePlate(licensePlate: string): Promise<any | null>; // Buscar por placa
	findAllByRole(
		role: "ADMIN" | "USER" | "MANAGER",
		skip: number,
		take: number,
	): Promise<{ users: User[]; total: number }>; // Listar usuarios por rol con paginación
	countAllUsers(): Promise<number>; // Contar el total de usuarios
	countActiveSubscribers(): Promise<number>; // Contar suscriptores activos
	findAllWithPagination(
		filters: IFilterGetAll,
	): Promise<{ users: User[]; total: number }>;
	getFirebaseTokensByType(type: "USER" | "MANAGER" | "ALL"): Promise<string[]>; // Obtener tokens de Firebase
	getUsersWithPendingPayments(): Promise<User[]>; // Obtener usuarios con pagos pendientes
	findUsersWithExpiringSubscriptions(): Promise<
		{ user: User; expiryDate: Date | null }[]
	>; // Usuarios con suscripciones por vencer

	// Métodos de manipulación de tokens de Firebase como lista
	addFirebaseToken(userId: number, firebaseToken: string): Promise<void>; // Agregar token de Firebase
	removeFirebaseToken(userId: number, firebaseToken: string): Promise<void>; // Remover token de Firebase
	getFirebaseTokensById(userId: number): Promise<string[]>; // Obtener todos los tokens de un usuario
}
