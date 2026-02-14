import {
	Prisma,
	type Car as PrismaCar,
	type Plan as PrismaPlan,
	type Subscription as PrismaSubscription,
	type User as PrismaUser,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { User } from "../../entities/User";
import type {
	IFilterGetAll,
	IUserRepository,
} from "../interfaces/IUserRepository";

interface UserWithSubscriptions extends PrismaUser {
	subscriptions?: PrismaSubscription[];
	cars?: PrismaCar[];
	plans?: PrismaPlan[];
	lastPaymentDate?: Date;
}

export class PrismaUserRepository implements IUserRepository {
	async findByEmail(
		email: string,
		withIsDeleted = false,
	): Promise<User | null> {
		// Retry logic para produção - tenta até 3 vezes com delay
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const userData = await prisma.user.findUnique({
					where: { email, deletedAt: !withIsDeleted ? null : undefined },
				});
				if (!userData) return null;
				return this.mapToEntity(userData);
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Se não for erro de conexão, não tenta novamente
				const isConnectionError =
					lastError.message.includes("connect") ||
					lastError.message.includes("timeout") ||
					lastError.message.includes("ECONNREFUSED") ||
					lastError.message.includes("ENOTFOUND") ||
					lastError.message.includes("P1001"); // Prisma connection error code

				if (!isConnectionError || attempt === maxRetries) {
					console.error("[PrismaUserRepository.findByEmail] Erro ao buscar usuário:", {
						email,
						attempt,
						maxRetries,
						error: lastError.message,
						stack: lastError.stack,
					});
					throw lastError;
				}

				// Aguarda antes de tentar novamente (exponential backoff)
				const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
				console.warn(`[PrismaUserRepository.findByEmail] Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${delay}ms...`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		// Nunca deve chegar aqui, mas TypeScript precisa
		throw lastError || new Error("Unknown error");
	}

	async findByCpf(
		cpf: string | null,
		withIsDeleted = false,
	): Promise<User | null> {
		if (!cpf) return null;
		const userData = await prisma.user.findUnique({
			where: { cpf, deletedAt: !withIsDeleted ? null : undefined },
		});
		if (!userData) return null;
		return this.mapToEntity(userData);
	}

	async findByLicensePlate(licensePlate: string): Promise<any | null> {
		const userData = await prisma.user.findFirst({
			where: {
				deletedAt: null,
				cars: {
					some: {
						plate: {
							contains: licensePlate,
							mode: Prisma.QueryMode.insensitive,
						},
					},
				},
			},
			include: {
				individualServicePurchases: {
					where: {
						status: "PENDING",
						payment: {
							status: "PAID",
						},
					},
					include: {
						washService: true,
					},
					orderBy: {
						createdAt: "asc",
					},
				},
				cars: {
					include: {
						subscriptions: {
							where: {
								isActive: true,
							},
							include: {
								plan: true,
							},
						},
					},
					where: {
						plate: {
							contains: licensePlate,
							mode: Prisma.QueryMode.insensitive,
						},
					},
				},
			},
		});

		if (!userData) return null;

		return {
			...userData,
			password: undefined,
			deletedAt: undefined,
			firebaseTokens: undefined,
			otp: undefined,
			// individualServicePurchases: undefined,
			asaasCustomerId: undefined,
			role: undefined,
			cpf: undefined,
		};
	}

	async findById(id: number) {
		const userData = await prisma.user.findUnique({
			where: { id, deletedAt: null },
			include: {
				subscriptions: {
					include: {
						plan: true,
						car: true,
					},
				},
				cars: true,
			},
		});

		if (!userData) return null;

		return userData;
	}

	async create(user: User): Promise<User> {
		const createdUser = await prisma.user.create({
			data: {
				name: user.name,
				email: user.email,
				password: user.password,
				role: user.role,
				phone: user.phone || "default-phone",
				cpf: user.cpf ?? undefined,
				profileImageUrl: user.profileImageUrl ?? undefined,
				firebaseTokens: [], // Inicializa a lista de tokens vazia
				otp: user.otp ?? undefined,
			},
		});

		return this.mapToEntity(createdUser);
	}

	async update(userId: number, data: Partial<User>): Promise<User> {
		const updatedUser = await prisma.user.update({
			where: { id: userId },
			data: {
				name: data.name,
				email: data.email,
				password: data.password,
				role: data.role,
				phone: data.phone ?? undefined,
				cpf: data.cpf ?? undefined,
				profileImageUrl: data.profileImageUrl ?? undefined,
				otp: data.otp ?? undefined,
				status: data.status ?? undefined,
				deletedAt: data.deletedAt ?? undefined,
			},
		});

		return this.mapToEntity(updatedUser);
	}

	async delete(userId: number): Promise<void> {
		await prisma.user.update({
			where: { id: userId },
			data: { deletedAt: new Date() },
		});
	}

	async findAll(): Promise<User[]> {
		const usersData = await prisma.user.findMany({
			where: { deletedAt: null },
		});
		return usersData.map(this.mapToEntity);
	}

	async findAllByRole(
		role: "ADMIN" | "USER" | "MANAGER",
		skip: number,
		take: number,
	): Promise<{ users: User[]; total: number }> {
		const usersData = await prisma.user.findMany({
			where: { role, deletedAt: null },
			skip,
			take,
		});

		const users = usersData.map(this.mapToEntity);
		const total = await prisma.user.count({
			where: { role, deletedAt: null },
		});

		return { users, total };
	}

	async countAllUsers(): Promise<number> {
		return await prisma.user.count({ where: { deletedAt: null } });
	}

	async countActiveSubscribers(): Promise<number> {
		return await prisma.subscription.count({
			where: {
				isActive: true,
			},
		});
	}

	async findAllWithPagination({
		page,
		pageSize,
		roles,
		searchTerm,
		orderBy = "createdAt",
		orderDirection = "desc",
		includePlans = false,
	}: IFilterGetAll): Promise<{ users: User[]; total: number }> {
		const skip = (page - 1) * pageSize;
		const take = pageSize;

		let usersData: UserWithSubscriptions[];
		let totalCount: number;

		if (orderBy === "lastPaymentDate") {
			// Buscar usuários ordenados pela data do pagamento mais recente
			// Usando uma subconsulta para ordenar corretamente
			// Preparar a condição de roles para SQL raw
			let rolesCondition = Prisma.empty;
			if (roles && roles.length > 0) {
				// Converter os roles para string e adicionar aspas para a consulta SQL
				const roleValues = roles.map((role) => `'${role}'`).join(", ");
				rolesCondition = Prisma.sql`AND u."role"::text IN (${Prisma.raw(roleValues)})`;
			}

			const usersWithLatestPayment = await prisma.$queryRaw<
				UserWithSubscriptions[]
			>`
				SELECT u.*, 
					MAX(p."createdAt") as "lastPaymentDate"
				FROM "User" u
				LEFT JOIN "Payment" p ON u.id = p."userId"
				WHERE u."deletedAt" IS NULL
				AND p."status" = 'PAID'
				${rolesCondition}
				${searchTerm
					? Prisma.sql`AND (
					u."name" ILIKE ${`%${searchTerm}%`} OR
					u."email" ILIKE ${`%${searchTerm}%`} OR
					u."phone" ILIKE ${`%${searchTerm}%`} OR
					u."cpf" ILIKE ${`%${searchTerm}%`}
				)`
					: Prisma.empty
				}
				GROUP BY u.id
				ORDER BY "lastPaymentDate" ${orderDirection === "desc" ? Prisma.sql`DESC NULLS LAST` : Prisma.sql`ASC NULLS FIRST`}
				LIMIT ${take} OFFSET ${skip}
			`;

			// Converter os resultados para o formato esperado
			usersData = usersWithLatestPayment.map((user) => {
				// Remover o campo lastPaymentDate que foi adicionado na consulta
				const { lastPaymentDate: _, ...userData } = user;
				return userData;
			});

			// Contar o total de registros com a mesma condição
			const totalResult = await prisma.$queryRaw<[{ count: bigint }]>`
				SELECT COUNT(DISTINCT u.id) as count
				FROM "User" u
				LEFT JOIN "Payment" p ON u.id = p."userId"
				WHERE u."deletedAt" IS NULL
				AND p."status" = 'PAID'
				${rolesCondition}
				${searchTerm
					? Prisma.sql`AND (
					u."name" ILIKE ${`%${searchTerm}%`} OR
					u."email" ILIKE ${`%${searchTerm}%`} OR
					u."phone" ILIKE ${`%${searchTerm}%`} OR
					u."cpf" ILIKE ${`%${searchTerm}%`}
				)`
					: Prisma.empty
				}
			`;

			// Definir o total com o resultado da contagem
			totalCount = Number(totalResult[0].count);

			if (includePlans) {
				for (let index = 0; index < usersData.length; index++) {
					const currentUser = usersData[index];
					const subscriptionWithPlan = await prisma.subscription.findMany({
						where: {
							userId: currentUser.id,
						},
						include: {
							plan: true,
							car: true,
						},
						orderBy: {
							createdAt: "desc",
						},
					});
					currentUser.subscriptions = subscriptionWithPlan;
				}
			}
		} else {
			const orderByPrisma: Prisma.UserOrderByWithRelationInput = {};
			orderByPrisma[orderBy] = orderDirection;

			const where: Prisma.UserWhereInput = {
				deletedAt: null,
				role: { in: roles },
				OR: !searchTerm
					? undefined
					: [
						{
							name: {
								contains: searchTerm,
								mode: Prisma.QueryMode.insensitive,
							},
						},
						{
							email: {
								contains: searchTerm,
								mode: Prisma.QueryMode.insensitive,
							},
						},
						{
							phone: {
								contains: searchTerm,
								mode: Prisma.QueryMode.insensitive,
							},
						},
						{
							cpf: {
								contains: searchTerm,
								mode: Prisma.QueryMode.insensitive,
							},
						},
					],
			};

			usersData = await prisma.user.findMany({
				skip,
				take,
				where,
				orderBy: orderByPrisma,
				include: {
					subscriptions: !includePlans
						? false
						: {
							include: {
								plan: true,
								car: true,
							},
							orderBy: {
								createdAt: "desc",
							},
						},
				},
			});

			// Contar o total para outros tipos de ordenação
			totalCount = await prisma.user.count({ where });
		}

		const users = usersData.map(this.mapToEntity);

		return { users, total: totalCount };
	}

	async getFirebaseTokensByType(
		type: "USER" | "MANAGER" | "ALL",
	): Promise<string[]> {
		const users = await prisma.user.findMany({
			where: {
				deletedAt: null,
				role: type === "ALL" ? undefined : type,
				firebaseTokens: {
					isEmpty: false,
				},
			},
			select: { firebaseTokens: true },
		});

		return users.flatMap((user) => user.firebaseTokens ?? []);
	}

	async addFirebaseToken(userId: number, firebaseToken: string): Promise<void> {
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) throw new Error("User not found");

		const updatedTokens = new Set(user.firebaseTokens ?? []);
		updatedTokens.add(firebaseToken);

		await prisma.user.update({
			where: { id: userId },
			data: { firebaseTokens: Array.from(updatedTokens) },
		});
	}

	async removeFirebaseToken(
		userId: number,
		firebaseToken: string,
	): Promise<void> {
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) throw new Error("User not found");

		const updatedTokens = (user.firebaseTokens ?? []).filter(
			(token) => token !== firebaseToken,
		);

		await prisma.user.update({
			where: { id: userId },
			data: { firebaseTokens: updatedTokens },
		});
	}

	async getFirebaseTokensById(userId: number): Promise<string[]> {
		const user = await prisma.user.findUnique({
			where: { id: userId, deletedAt: null },
			select: { firebaseTokens: true },
		});

		return user?.firebaseTokens ?? [];
	}

	async findUsersWithExpiringSubscriptions(): Promise<
		{ user: User; expiryDate: Date | null }[]
	> {
		const upcomingExpiryDate = new Date();
		upcomingExpiryDate.setDate(upcomingExpiryDate.getDate() + 7);

		const expiringSubscriptions = await prisma.subscription.findMany({
			where: {
				isActive: true,
				expiresAt: {
					lte: upcomingExpiryDate,
				},
			},
			select: {
				expiresAt: true,
				user: {
					select: {
						id: true,
						name: true,
						email: true,
						password: true,
						phone: true,
						cpf: true,
						role: true,
						profileImageUrl: true,
						firebaseTokens: true,
						otp: true,
					},
				},
			},
		});

		return expiringSubscriptions.map((subscription) => ({
			user: this.mapToEntity(subscription.user),
			expiryDate: subscription.expiresAt,
		}));
	}

	async getUsersWithPendingPayments(): Promise<User[]> {
		const usersData = await prisma.user.findMany({
			where: {
				deletedAt: null,
				payments: {
					some: { status: "PENDING" },
				},
			},
		});

		return usersData.map(this.mapToEntity);
	}

	private mapToEntity(userData: any): User {
		return new User({
			id: userData.id,
			name: userData.name,
			email: userData.email,
			password: userData.password,
			phone: userData.phone,
			cpf: userData.cpf,
			role: userData.role as "ADMIN" | "USER" | "MANAGER",
			profileImageUrl: userData.profileImageUrl,
			firebaseTokens: userData.firebaseTokens || [],
			otp: userData.otp,
			status: userData.status as "ACTIVE" | "INACTIVE",
			subscriptions: userData.subscriptions || [],
			createdAt: userData.createdAt,
			updatedAt: userData.updatedAt,
			cars: userData.cars || [],
			washLocations: userData.washLocations || [],
			washServices: userData.washServices || [],
			payments: userData.payments || [],
			notifications: userData.notifications || [],
			asaasCustomerId: userData.asaasCustomerId,
			deletedAt: userData.deletedAt,
		});
	}
}
