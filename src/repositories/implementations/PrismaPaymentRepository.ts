// src/repositories/implementations/PrismaPaymentRepository.ts

import type { PurchaseStatus } from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Payment } from "../../entities/Payment";
import type { GetAllPaymentsWithDetailsDTO } from "../../modules/payment/dto/GetAllPaymentsWithDetailsDTO";
import type {
	IPaymentRepository,
	PaymentFilter,
} from "../interfaces/IPaymentRepository";

export class PrismaPaymentRepository implements IPaymentRepository {
	public async create(data: Payment): Promise<Payment> {
		const created = await prisma.payment.create({
			data: {
				userId: data.userId,
				planId: data.planId,
				couponId: data.couponId,
				amount: data.amount,
				paymentDate: data.paymentDate,
				status: data.status,
				pixQrCode: data.pixQrCode,
				pixPayload: data.pixPayload,
				paymentMethodId: data.paymentMethodId,
				paymentIdAsaas: data.paymentIdAsaas,
				installments: data.installments,
			},
		});

		return new Payment({
			id: created.id,
			userId: created.userId,
			planId: created.planId,
			couponId: created.couponId,
			amount: created.amount,
			paymentDate: created.paymentDate,
			status: created.status,
			pixQrCode: created.pixQrCode,
			pixPayload: created.pixPayload,
			paymentMethodId: created.paymentMethodId,
			paymentIdAsaas: created.paymentIdAsaas,
			installments: created.installments,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
		});
	}

	// Obtener monto total
	public async getTotalRevenue(): Promise<number> {
		const total = await prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
		});
		return total._sum.amount || 0;
	}

	public async getCurrentMonthRevenue(): Promise<number> {
		const total = await prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				paymentDate: {
					gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
					lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
				},
				status: "PAID",
			},
		});
		return total._sum.amount || 0;
	}

	public async getAll(filter: PaymentFilter): Promise<Payment[]> {
		const whereClause: any = {};

		if (filter.id) whereClause.id = filter.id;
		if (filter.userId) whereClause.userId = filter.userId;
		if (filter.planId) whereClause.planId = filter.planId;
		if (filter.paymentIdAsaas)
			whereClause.paymentIdAsaas = filter.paymentIdAsaas;

		const results = await prisma.payment.findMany({
			where: whereClause,
			orderBy: { createdAt: "desc" },
		});

		return results.map(
			(p) =>
				new Payment({
					id: p.id,
					userId: p.userId,
					planId: p.planId,
					amount: p.amount,
					paymentDate: p.paymentDate,
					status: p.status,
					installments: p.installments,
					createdAt: p.createdAt,
					updatedAt: p.updatedAt,
					paymentMethodId: p.paymentMethodId,
					paymentIdAsaas: p.paymentIdAsaas,
				}),
		);
	}

	public async getNextMonthPredictedRevenue(): Promise<number> {
		const nextMonthStart = new Date(
			new Date().getFullYear(),
			new Date().getMonth() + 1,
			1,
		);
		const nextMonthEnd = new Date(
			new Date().getFullYear(),
			new Date().getMonth() + 2,
			0,
		);

		// Ejemplo: Se asume que tu modelo Subscription tiene campo 'amount', 'isActive', etc.
		const total = await prisma.subscription.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				isActive: true,
				endDate: {
					gte: nextMonthStart,
					lte: nextMonthEnd,
				},
			},
		});
		return total._sum.amount || 0;
	}

	public async getAllPaymentsWithDetails(
		data: GetAllPaymentsWithDetailsDTO,
	): Promise<any> {
		const { page, pageSize, status } = data;

		const payments = await prisma.payment.findMany({
			select: {
				id: true,
				amount: true,
				paymentDate: true,
				status: true,
				user: {
					select: {
						name: true,
					},
				},
			},
			where: {
				status,
			},
			take: pageSize,
			skip: (page - 1) * pageSize,
			orderBy: {
				paymentDate: "desc",
			},
		});

		const total = await prisma.payment.count({
			where: {
				status,
			},
		});

		return {
			data: payments,
			total: Math.ceil(total / pageSize),
		};
	}

	public async getMonthlyRevenueHistory(): Promise<
		{ month: string; total: number }[]
	> {
		return await prisma.$queryRaw<{ month: string; total: number }[]>`
      SELECT TO_CHAR("paymentDate", 'YYYY-MM') AS month, SUM("amount") AS total
      FROM "Payment"
      GROUP BY month
      ORDER BY month DESC
    `;
	}

	public async getYearlyRevenueHistory(): Promise<
		{ year: number; total: number }[]
	> {
		return await prisma.$queryRaw<{ year: number; total: number }[]>`
      SELECT EXTRACT(YEAR FROM "paymentDate") AS year, SUM("amount") AS total
      FROM "Payment"
      GROUP BY year
      ORDER BY year DESC
    `;
	}

	public async updatePaymentStatus(
		paymentId: number,
		status: "PAID" | "PENDING" | "CANCELED",
	): Promise<void> {
		await prisma.payment.update({
			where: { id: paymentId },
			data: { status },
		});
	}

	public async getPaymentDetailsById(paymentId: number) {
		const payment = await prisma.payment.findUnique({
			where: { id: paymentId },
			select: {
				id: true,
				amount: true,
				paymentDate: true,
				status: true,
				pixQrCode: true,
				pixPayload: true,
				installments: true,
				createdAt: true,
				updatedAt: true,
				user: {
					select: {
						name: true,
						cpf: true,
					},
				},
				plan: {
					select: {
						name: true,
						price: true,
					},
				},
				coupon: {
					select: {
						code: true,
						discountValue: true,
						discountType: true,
					},
				},
				individualServicePurchases: {
					select: {
						id: true,
						status: true,
						createdAt: true,
						updatedAt: true,
						washService: {
							select: {
								id: true,
								name: true,
								price: true,
							},
						},
					},
				},
			},
		});

		return payment;
	}

	public async getMRR(): Promise<number> {
		// Ejemplo de MRR: filtrar plan "MONTHLY"
		const total = await prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				plan: {
					name: "MONTHLY",
				},
				status: {
					in: ["PAID", "PENDING"],
				},
				paymentDate: {
					gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
					lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
				},
			},
		});
		return total._sum?.amount ?? 0;
	}

	public async getOneByFilter(filter: {
		payment_id?: string;
		id?: number;
		paymentIdAsaas?: string;
	}): Promise<Payment | null> {
		const whereClause: any = {};
		if (filter.id) whereClause.id = filter.id;
		if (filter.payment_id) whereClause.paymentIdAsaas = filter.payment_id;
		if (filter.paymentIdAsaas)
			whereClause.paymentIdAsaas = filter.paymentIdAsaas;

		const payment = await prisma.payment.findFirst({ where: whereClause });
		return payment ? new Payment(payment) : null;
	}

	public async update(
		filter: { id: number },
		{ id: _, ...data }: Partial<Payment>,
		updateIndividualStatus: boolean = false,
	): Promise<Payment | null> {
		const individualStatusMap = new Map<Payment["status"], PurchaseStatus>([
			["PAID", "COMPLETED"],
			["PENDING", "PENDING"],
			["CANCELED", "CANCELED"],
		]);

		const individualStatus =
			individualStatusMap.get(data.status ?? "PENDING") ?? "PENDING";
		const updatedPayment = await prisma.payment.update({
			where: { id: filter.id },
			data: {
				...data,
				individualServicePurchases: !updateIndividualStatus
					? undefined
					: {
							updateMany: {
								where: {
									paymentId: filter.id,
								},
								data: {
									status: individualStatus,
								},
							},
						},
			},
		});

		return new Payment(updatedPayment);
	}

	public async getByAsaasId(paymentIdAsaas: string): Promise<Payment | null> {
		const payment = await prisma.payment.findFirst({
			where: { paymentIdAsaas },
		});
		return payment ? new Payment(payment) : null;
	}
}
