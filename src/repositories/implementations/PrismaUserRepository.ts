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
	AttachReferralResult,
	CreateUserReferralInput,
	IFilterGetAll,
	IUserRepository,
	ReferralRequestContext,
} from "../interfaces/IUserRepository";

interface UserWithSubscriptions extends PrismaUser {
	subscriptions?: PrismaSubscription[];
	cars?: PrismaCar[];
	plans?: PrismaPlan[];
	lastPaymentDate?: Date;
}

export class PrismaUserRepository implements IUserRepository {
	private normalizePlate(value: string): string {
		return (value ?? "")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "");
	}

	private normalizeReferralCode(value: string): string {
		return (value ?? "").trim().toUpperCase();
	}

	async findByEmail(email: string, withIsDeleted = false): Promise<User | null> {
		const userData = await prisma.user.findFirst({
			where: {
				email,
				deletedAt: !withIsDeleted ? null : undefined,
			},
		});
		if (!userData) return null;
		return this.mapToEntity(userData);
	}

	async findByCpf(cpf: string | null, withIsDeleted = false): Promise<User | null> {
		if (!cpf) return null;

		const userData = await prisma.user.findFirst({
			where: {
				cpf,
				deletedAt: !withIsDeleted ? null : undefined,
			},
		});

		if (!userData) return null;
		return this.mapToEntity(userData);
	}

	/**
	 * CORREÇÃO: O campo no Prisma é `licensePlate`, não `plate`.
	 * Além disso, normalizamos a placa para evitar falhas (hífen/espaço/letras minúsculas).
	 */
	async findByLicensePlate(licensePlate: string): Promise<any | null> {
		const normalized = this.normalizePlate(licensePlate);

		if (!normalized) return null;

		const userData = await prisma.user.findFirst({
			where: {
				deletedAt: null,
				cars: {
					some: {
						deletedAt: null,
						licensePlate: {
							contains: normalized,
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
						deletedAt: null,
						licensePlate: {
							contains: normalized,
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
			asaasCustomerId: undefined,
			role: undefined,
			cpf: undefined,
		};
	}

	async findById(id: number, withIsDeleted = false): Promise<User | null> {
		const userData = await prisma.user.findFirst({
			where: {
				id,
				deletedAt: !withIsDeleted ? null : undefined,
			},
			include: {
				subscriptions: {
					where: {
						isActive: true,
					},
					include: {
						plan: true,
						car: true,
					},
				},
				cars: true,
			},
		});

		if (!userData) return null;

		return this.mapToEntity(userData);
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
				firebaseTokens: user.firebaseTokens ?? [],
				otp: user.otp ?? undefined,

				// REFERRALS (FASE 1/2/3)
				referralCode: (user as any).referralCode ?? undefined,
				referrerId: (user as any).referrerId ?? undefined,
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

				// REFERRALS (FASE 1/2/3)
				referralCode: (data as any).referralCode ?? undefined,
				referrerId: (data as any).referrerId ?? undefined,
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
		return usersData.map((u) => this.mapToEntity(u));
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

		const users = usersData.map((u) => this.mapToEntity(u));
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
			let rolesCondition = Prisma.empty;
			if (roles && roles.length > 0) {
				const roleValues = roles.map((role) => `'${role}'`).join(", ");
				rolesCondition = Prisma.sql`AND u."role"::text IN (${Prisma.raw(roleValues)})`;
			}

			const usersWithLatestPayment = await prisma.$queryRaw<UserWithSubscriptions[]>`
				SELECT u.*,
					   MAX(p."createdAt") as "lastPaymentDate"
				FROM "User" u
						 LEFT JOIN "Payment" p ON u.id = p."userId"
				WHERE u."deletedAt" IS NULL
				  AND p."status" = 'PAID'
					${rolesCondition}
					${
				searchTerm
					? Prisma.sql`AND (
					u."name" ILIKE ${`%${searchTerm}%`} OR
					u."email" ILIKE ${`%${searchTerm}%`} OR
					u."phone" ILIKE ${`%${searchTerm}%`} OR
					u."cpf" ILIKE ${`%${searchTerm}%`} OR
					u."referralCode" ILIKE ${`%${searchTerm}%`}
				)`
					: Prisma.empty
			}
				GROUP BY u.id
				ORDER BY "lastPaymentDate" ${
				orderDirection === "desc"
					? Prisma.sql`DESC NULLS LAST`
					: Prisma.sql`ASC NULLS FIRST`
			}
					LIMIT ${take} OFFSET ${skip}
			`;

			usersData = usersWithLatestPayment.map((user) => {
				const { lastPaymentDate: _, ...userData } = user;
				return userData;
			});

			const totalResult = await prisma.$queryRaw<[{ count: bigint }]>`
				SELECT COUNT(DISTINCT u.id) as count
				FROM "User" u
					LEFT JOIN "Payment" p ON u.id = p."userId"
				WHERE u."deletedAt" IS NULL
				  AND p."status" = 'PAID'
					${rolesCondition}
					${
				searchTerm
					? Prisma.sql`AND (
					u."name" ILIKE ${`%${searchTerm}%`} OR
					u."email" ILIKE ${`%${searchTerm}%`} OR
					u."phone" ILIKE ${`%${searchTerm}%`} OR
					u."cpf" ILIKE ${`%${searchTerm}%`} OR
					u."referralCode" ILIKE ${`%${searchTerm}%`}
				)`
					: Prisma.empty
			}
			`;

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
				role: roles && roles.length > 0 ? { in: roles } : undefined,
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
						{
							referralCode: {
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

			totalCount = await prisma.user.count({ where });
		}

		const users = usersData.map((u) => this.mapToEntity(u));

		return { users, total: totalCount };
	}

	async getFirebaseTokensByType(type: "USER" | "MANAGER" | "ALL"): Promise<string[]> {
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

	async removeFirebaseToken(userId: number, firebaseToken: string): Promise<void> {
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
		const user = await prisma.user.findFirst({
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

						// REFERRALS (FASE 1/2/3)
						referralCode: true,
						referrerId: true,
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

		return usersData.map((u) => this.mapToEntity(u));
	}

	// ---------------------------------------------------------------------
	// REFERRALS (FASE 1/2/3) — SUPORTE AO MÓDULO referrals + cadastro
	// ---------------------------------------------------------------------

	async findByReferralCode(
		referralCode: string,
		withIsDeleted = false,
	): Promise<User | null> {
		const code = this.normalizeReferralCode(referralCode);
		if (!code) return null;

		const userData = await prisma.user.findFirst({
			where: {
				referralCode: {
					equals: code,
					mode: Prisma.QueryMode.insensitive,
				},
				deletedAt: !withIsDeleted ? null : undefined,
			},
		});

		if (!userData) return null;
		return this.mapToEntity(userData);
	}

	async updateReferralCode(userId: number, referralCode: string): Promise<User> {
		const code = this.normalizeReferralCode(referralCode);

		const updatedUser = await prisma.user.update({
			where: { id: userId },
			data: { referralCode: code },
		});

		return this.mapToEntity(updatedUser);
	}

	async updateReferrerId(userId: number, referrerId: number | null): Promise<User> {
		const updatedUser = await prisma.user.update({
			where: { id: userId },
			data: { referrerId },
		});

		return this.mapToEntity(updatedUser);
	}

	async createUserReferral(input: CreateUserReferralInput): Promise<void> {
		await prisma.userReferral.create({
			data: {
				referrerId: input.referrerId,
				referredId: input.referredId,
				source: input.source as any,
				deviceId: input.deviceId ?? null,
				ip: input.ip ?? null,
				userAgent: input.userAgent ?? null,
				meta: (input.meta as any) ?? undefined,
			},
		});
	}

	async hasReferralReceived(referredId: number): Promise<boolean> {
		const count = await prisma.userReferral.count({
			where: { referredId },
		});
		return count > 0;
	}

	async hasReferrerAttached(referredId: number): Promise<boolean> {
		const user = await prisma.user.findFirst({
			where: { id: referredId },
			select: { referrerId: true, deletedAt: true },
		});

		if (!user) return false;
		if (user.deletedAt) return false;

		return user.referrerId !== null && user.referrerId !== undefined;
	}

	/**
	 * Implementação robusta e transacional do attachReferralOnSignup.
	 *
	 * - Resolve referrer pelo referralCode
	 * - Bloqueia:
	 *   - self-referral
	 *   - referrer deletado/inativo
	 *   - rebind (se já tem referrerId) e/ou já tem audit (UserReferral)
	 * - Escreve:
	 *   - User.referrerId
	 *   - UserReferral (auditoria)
	 */
	async attachReferralOnSignup(params: {
		referredId: number;
		referralCode: string;
		context: ReferralRequestContext;
	}): Promise<AttachReferralResult> {
		const referredId = params.referredId;
		const code = this.normalizeReferralCode(params.referralCode);

		if (!code) {
			return {
				attached: false,
				reason: "NO_CODE",
				referredId,
				referrerId: null,
				referralCodeUsed: null,
			};
		}

		const referred = await prisma.user.findFirst({
			where: { id: referredId },
			select: { id: true, referrerId: true, deletedAt: true, status: true },
		});

		if (!referred || referred.deletedAt) {
			return {
				attached: false,
				reason: "INVALID_CODE",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		// Bloqueia rebind direto pelo User.referrerId
		if (referred.referrerId !== null && referred.referrerId !== undefined) {
			return {
				attached: false,
				reason: "ALREADY_HAS_REFERRER",
				referredId,
				referrerId: referred.referrerId,
				referralCodeUsed: code,
			};
		}

		// Bloqueia se já existe auditoria (UserReferral)
		const alreadyAudit = await prisma.userReferral.count({
			where: { referredId },
		});
		if (alreadyAudit > 0) {
			return {
				attached: false,
				reason: "ALREADY_HAS_REFERRAL_AUDIT",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		const referrer = await prisma.user.findFirst({
			where: {
				deletedAt: null,
				referralCode: {
					equals: code,
					mode: Prisma.QueryMode.insensitive,
				},
			},
			select: { id: true, status: true, deletedAt: true },
		});

		if (!referrer) {
			return {
				attached: false,
				reason: "REFERRER_NOT_FOUND",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		if (referrer.deletedAt) {
			return {
				attached: false,
				reason: "REFERRER_DELETED",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		if (referrer.status !== "ACTIVE") {
			return {
				attached: false,
				reason: "REFERRER_INACTIVE",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		if (referrer.id === referredId) {
			return {
				attached: false,
				reason: "SELF_REFERRAL_BLOCKED",
				referredId,
				referrerId: null,
				referralCodeUsed: code,
			};
		}

		const context = params.context;

		await prisma.$transaction(async (tx) => {
			await tx.user.update({
				where: { id: referredId },
				data: { referrerId: referrer.id },
			});

			await tx.userReferral.create({
				data: {
					referrerId: referrer.id,
					referredId: referredId,
					source: context.source as any,
					deviceId: context.deviceId ?? null,
					ip: context.ip ?? null,
					userAgent: context.userAgent ?? null,
					meta: (context.meta as any) ?? undefined,
				},
			});
		});

		return {
			attached: true,
			reason: "ATTACHED",
			referredId,
			referrerId: referrer.id,
			referralCodeUsed: code,
		};
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

			// REFERRALS (FASE 1/2/3)
			referralCode: userData.referralCode,
			referrerId: userData.referrerId,
		});
	}
}
