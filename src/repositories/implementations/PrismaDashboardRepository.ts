import prisma from "../../config/dbConfig";
import type {
	IDashboardRepository,
	ListData,
	TopPlan,
	TopUser,
	TopWashService,
	WashLocationsByDailyWashes,
} from "../interfaces/IDashboardRepository";

export class PrismaDashboardRepository implements IDashboardRepository {
	async getMRR(): Promise<number> {
		// Calculate MRR from active subscriptions
		const result = await prisma.subscription.aggregate({
			where: {
				isActive: true,
				endDate: {
					gte: new Date(), // Only consider active subscriptions that haven't expired
				},
			},
			_avg: {
				amount: true,
			},
		});

		return result._avg.amount || 0;
	}

	async getTotalRevenue(): Promise<number> {
		const result = await prisma.payment.aggregate({
			where: {
				status: "PAID",
			},
			_sum: {
				amount: true,
			},
		});
		return result._sum.amount || 0;
	}

	async getYearlyRevenueHistory(): Promise<{ year: number; total: number }[]> {
		// Get all paid payments grouped by year
		const results = await prisma.$queryRaw<{ year: number; total: number }[]>`
			SELECT 
				EXTRACT(YEAR FROM "paymentDate") as year,
				SUM(amount) as total
			FROM "Payment"
			WHERE status = 'PAID'
			GROUP BY EXTRACT(YEAR FROM "paymentDate")
			ORDER BY year ASC
		`;

		return results.map((item) => ({
			year: Number(item.year),
			total: Number(item.total),
		}));
	}

	async getCurrentMonthRevenue(): Promise<number> {
		const result = await prisma.payment.aggregate({
			where: {
				status: "PAID",
				paymentDate: {
					gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
					lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
				},
			},
			_sum: {
				amount: true,
			},
		});

		return result._sum.amount || 0;
	}

	async getTopUsersByDailyWashes(): Promise<ListData<TopUser>> {
		// Get users with the most daily washes by joining through cars
		const topUsers = await prisma.user.findMany({
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
				createdAt: true,
				updatedAt: true,
				deletedAt: true,
				_count: {
					select: {
						cars: {
							where: {
								dailyWashes: {
									some: {}, // Count cars that have any daily washes
								},
							},
						},
					},
				},
			},
			where: {
				deletedAt: null, // Only active users
				cars: {
					some: {
						dailyWashes: {
							some: {}, // Only users who have cars with daily washes
						},
					},
				},
			},
			orderBy: {
				cars: {
					_count: "desc", // Order by number of cars with daily washes
				},
			},
			take: 10, // Limit to top 10 users
		});

		// Map results to User entities and count total daily washes per user
		const usersWithWashCounts = await Promise.all(
			topUsers.map(async (userData) => {
				// Get total daily washes for this user's cars
				const dailyWashCount = await prisma.dailyWash.count({
					where: {
						car: {
							userId: userData.id,
							deletedAt: null,
						},
					},
				});
				return {
					user: {
						id: userData.id,
						name: userData.name,
						email: userData.email,
						phone: userData.phone,
					},
					dailyWashesCount: dailyWashCount,
				};
			}),
		);

		// Sort by daily wash count in descending order
		usersWithWashCounts.sort((a, b) => {
			const aCount = a.dailyWashesCount;
			const bCount = b.dailyWashesCount;
			return bCount - aCount;
		});

		return {
			total: usersWithWashCounts.length,
			data: usersWithWashCounts,
		};
	}

	async getTopServicesSold(): Promise<ListData<TopWashService>> {
		// Get services with the most individual purchases
		const topServices = await prisma.washService.findMany({
			where: {
				isAvailable: true,
				individualServicePurchases: {
					some: {
						status: {
							in: ["COMPLETED", "PENDING"],
						},
						payment: {
							status: "PAID",
						},
					},
				},
			},
			select: {
				id: true,
				name: true,
				price: true,
				imageUrl: true,
				isAvailable: true,
				adminId: true,
				_count: {
					select: {
						individualServicePurchases: {
							where: {
								status: {
									in: ["COMPLETED", "PENDING"],
								},
								payment: {
									status: "PAID",
								},
							},
						},
					},
				},
			},
			orderBy: {
				individualServicePurchases: {
					_count: "desc", // Order by number of purchases
				},
			},
			take: 10, // Limit to top 10 services
		});

		return {
			total: topServices.length,
			data: topServices.map((service) => ({
				service: {
					id: service.id,
					name: service.name,
					price: service.price,
					imageUrl: service.imageUrl,
					isAvailable: service.isAvailable,
					adminId: service.adminId,
				},
				purchaseCount: service._count.individualServicePurchases,
			})),
		};
	}

	async getTopPlansSold(): Promise<ListData<TopPlan>> {
		// Get plans with the most subscriptions
		const topPlans = await prisma.plan.findMany({
			where: {
				subscriptions: {
					some: {
						isActive: true,
					},
				},
				payments: {
					some: {
						status: "PAID",
					},
				},
			},
			select: {
				id: true,
				name: true,
				description: true,
				price: true,
				duration: true,
				isBestChoice: true,
				periodicityType: true,
				_count: {
					select: {
						subscriptions: {
							where: {
								isActive: true,
							},
						},
					},
				},
			},
			orderBy: {
				subscriptions: {
					_count: "desc",
				},
			},
			take: 10,
		});

		return {
			total: topPlans.length,
			data: topPlans.map((plan) => ({
				plan: {
					id: plan.id,
					name: plan.name,
					description: plan.description,
					price: plan.price,
					duration: plan.duration,
					isBestChoice: plan.isBestChoice,
					periodicityType: plan.periodicityType,
				},
				subscriptionCount: plan._count.subscriptions,
			})),
		};
	}

	async orderWashLocationsByDailyWashes(): Promise<
		ListData<WashLocationsByDailyWashes>
	> {
		// Calculate date 3 months ago from now
		const threeMonthsAgo = new Date();
		threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

		const washLocations = await prisma.washLocation.findMany({
			select: {
				id: true,
				name: true,
				images: true,
				street: true,
				number: true,
				neighborhood: true,
				city: true,
				dailyWashes: {
					where: {
						createdAt: {
							gte: threeMonthsAgo,
						},
					},
					select: {
						id: true,
						createdAt: true,
					},
				},
			},
		});

		// Process data to group by day
		const locationDailyData = washLocations.map((location) => {
			// Group washes by day
			const washesByDay = location.dailyWashes.reduce<Record<string, number>>(
				(acc, wash) => {
					// Format date as YYYY-MM-DD
					const day = wash.createdAt.toISOString().split("T")[0];
					acc[day] = (acc[day] || 0) + 1;
					return acc;
				},
				{},
			);

			// Calculate total washes for sorting
			const totalWashes = location.dailyWashes.length;

			return {
				location: {
					id: location.id,
					name: location.name,
					images: location.images,
					street: location.street,
					number: location.number,
					neighborhood: location.neighborhood,
					city: location.city,
				},
				dailyWashesCount: totalWashes,
				dailyWashesByDate: Object.entries(washesByDay)
					.map(([date, count]) => ({
						date,
						count,
					}))
					.sort(
						(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
					),
			};
		});

		return {
			total: locationDailyData.length,
			data: locationDailyData.sort(
				(a, b) => b.dailyWashesCount - a.dailyWashesCount,
			),
		};
	}
}
