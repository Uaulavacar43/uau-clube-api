// src/repositories/implementations/PrismaPaymentRepository.ts

import type {
    Payment as PrismaPayment,
    Prisma,
    PurchaseStatus,
} from "@prisma/client";
import { PeriodicityType as PrismaPeriodicityType } from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Payment } from "../../entities/Payment";
import type { GetAllPaymentsWithDetailsDTO } from "../../modules/payment/dto/GetAllPaymentsWithDetailsDTO";
import type {
    IPaymentRepository,
    PaymentFilter,
} from "../interfaces/IPaymentRepository";

interface PaymentsWithDetailsResult {
    data: {
        id: number;
        amount: number;
        paymentDate: Date | null;
        status: string;
        user: {
            name: string | null;
        };
    }[];
    total: number;
}

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
            couponId: created.couponId ?? undefined,
            amount: created.amount,
            paymentDate: created.paymentDate,
            status: created.status,
            pixQrCode: created.pixQrCode ?? null,
            pixPayload: created.pixPayload ?? null,
            paymentMethodId: created.paymentMethodId ?? null,
            paymentIdAsaas: created.paymentIdAsaas ?? null,
            installments: created.installments ?? null,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
        });
    }

    public async getTotalRevenue(): Promise<number> {
        const total = await prisma.payment.aggregate({
            _sum: {
                amount: true,
            },
        });

        return total._sum.amount ?? 0;
    }

    public async getCurrentMonthRevenue(): Promise<number> {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const monthStart = new Date(year, month, 1);
        const nextMonthStart = new Date(year, month + 1, 1);

        const total = await prisma.payment.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                paymentDate: {
                    gte: monthStart,
                    lt: nextMonthStart,
                },
                status: "PAID",
            },
        });

        return total._sum.amount ?? 0;
    }

    public async getAll(filter: PaymentFilter): Promise<Payment[]> {
        const whereClause: Prisma.PaymentWhereInput = {};

        if (typeof filter.id === "number") {
            whereClause.id = filter.id;
        }

        if (typeof filter.userId === "number") {
            whereClause.userId = filter.userId;
        }

        if (typeof filter.planId === "number") {
            whereClause.planId = filter.planId;
        }

        if (typeof filter.paymentIdAsaas === "string") {
            whereClause.paymentIdAsaas = filter.paymentIdAsaas;
        }

        const results = await prisma.payment.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
        });

        return results.map(
            (paymentRecord: PrismaPayment) =>
                new Payment({
                    id: paymentRecord.id,
                    userId: paymentRecord.userId,
                    planId: paymentRecord.planId,
                    couponId: paymentRecord.couponId ?? undefined,
                    amount: paymentRecord.amount,
                    paymentDate: paymentRecord.paymentDate,
                    status: paymentRecord.status,
                    installments: paymentRecord.installments ?? null,
                    createdAt: paymentRecord.createdAt,
                    updatedAt: paymentRecord.updatedAt,
                    pixQrCode: paymentRecord.pixQrCode ?? null,
                    pixPayload: paymentRecord.pixPayload ?? null,
                    paymentMethodId: paymentRecord.paymentMethodId ?? null,
                    paymentIdAsaas: paymentRecord.paymentIdAsaas ?? null,
                }),
        );
    }

    public async getNextMonthPredictedRevenue(): Promise<number> {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const nextMonthStart = new Date(year, month + 1, 1);
        const nextMonthEnd = new Date(year, month + 2, 0);

        const total = await prisma.subscription.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                isActive: true,
                expiresAt: {
                    gte: nextMonthStart,
                    lte: nextMonthEnd,
                },
            },
        });

        return total._sum.amount ?? 0;
    }

    public async getAllPaymentsWithDetails(
        data: GetAllPaymentsWithDetailsDTO,
    ): Promise<PaymentsWithDetailsResult> {
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
                status: status,
            },
            take: pageSize,
            skip: (page - 1) * pageSize,
            orderBy: {
                paymentDate: "desc",
            },
        });

        const totalCount = await prisma.payment.count({
            where: {
                status: status,
            },
        });

        const totalPages = Math.ceil(totalCount / pageSize);

        return {
            data: payments,
            total: totalPages,
        };
    }

    public async getMonthlyRevenueHistory(): Promise<
        { month: string; total: number }[]
    > {
        return prisma.$queryRaw<{ month: string; total: number }[]>`
            SELECT TO_CHAR("paymentDate", 'YYYY-MM') AS month, SUM("amount") AS total
            FROM "Payment"
            GROUP BY month
            ORDER BY month DESC
        `;
    }

    public async getYearlyRevenueHistory(): Promise<
        { year: number; total: number }[]
    > {
        return prisma.$queryRaw<{ year: number; total: number }[]>`
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
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const monthStart = new Date(year, month, 1);
        const nextMonthStart = new Date(year, month + 1, 1);

        const total = await prisma.payment.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                plan: {
                    periodicityType: PrismaPeriodicityType.MONTH,
                },
                status: {
                    in: ["PAID", "PENDING"],
                },
                paymentDate: {
                    gte: monthStart,
                    lt: nextMonthStart,
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
        const whereClause: Prisma.PaymentWhereInput = {};

        if (typeof filter.id === "number") {
            whereClause.id = filter.id;
        }

        if (typeof filter.payment_id === "string") {
            whereClause.paymentIdAsaas = filter.payment_id;
        }

        if (typeof filter.paymentIdAsaas === "string") {
            whereClause.paymentIdAsaas = filter.paymentIdAsaas;
        }

        const paymentRecord = await prisma.payment.findFirst({
            where: whereClause,
        });

        if (!paymentRecord) {
            return null;
        }

        return new Payment({
            id: paymentRecord.id,
            userId: paymentRecord.userId,
            planId: paymentRecord.planId,
            couponId: paymentRecord.couponId ?? undefined,
            amount: paymentRecord.amount,
            paymentDate: paymentRecord.paymentDate,
            status: paymentRecord.status,
            installments: paymentRecord.installments ?? null,
            createdAt: paymentRecord.createdAt,
            updatedAt: paymentRecord.updatedAt,
            pixQrCode: paymentRecord.pixQrCode ?? null,
            pixPayload: paymentRecord.pixPayload ?? null,
            paymentMethodId: paymentRecord.paymentMethodId ?? null,
            paymentIdAsaas: paymentRecord.paymentIdAsaas ?? null,
        });
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

        const paymentStatus: Payment["status"] =
            data.status ?? "PENDING";

        const individualStatus =
            individualStatusMap.get(paymentStatus) ?? "PENDING";

        const updatedPaymentRecord = await prisma.payment.update({
            where: { id: filter.id },
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

        return new Payment({
            id: updatedPaymentRecord.id,
            userId: updatedPaymentRecord.userId,
            planId: updatedPaymentRecord.planId,
            couponId: updatedPaymentRecord.couponId ?? undefined,
            amount: updatedPaymentRecord.amount,
            paymentDate: updatedPaymentRecord.paymentDate,
            status: updatedPaymentRecord.status,
            installments: updatedPaymentRecord.installments ?? null,
            createdAt: updatedPaymentRecord.createdAt,
            updatedAt: updatedPaymentRecord.updatedAt,
            pixQrCode: updatedPaymentRecord.pixQrCode ?? null,
            pixPayload: updatedPaymentRecord.pixPayload ?? null,
            paymentMethodId: updatedPaymentRecord.paymentMethodId ?? null,
            paymentIdAsaas: updatedPaymentRecord.paymentIdAsaas ?? null,
        });
    }

    public async getByAsaasId(paymentIdAsaas: string): Promise<Payment | null> {
        const paymentRecord = await prisma.payment.findFirst({
            where: { paymentIdAsaas },
        });

        if (!paymentRecord) {
            return null;
        }

        return new Payment({
            id: paymentRecord.id,
            userId: paymentRecord.userId,
            planId: paymentRecord.planId,
            couponId: paymentRecord.couponId ?? undefined,
            amount: paymentRecord.amount,
            paymentDate: paymentRecord.paymentDate,
            status: paymentRecord.status,
            installments: paymentRecord.installments ?? null,
            createdAt: paymentRecord.createdAt,
            updatedAt: paymentRecord.updatedAt,
            pixQrCode: paymentRecord.pixQrCode ?? null,
            pixPayload: paymentRecord.pixPayload ?? null,
            paymentMethodId: paymentRecord.paymentMethodId ?? null,
            paymentIdAsaas: paymentRecord.paymentIdAsaas ?? null,
        });
    }
}
