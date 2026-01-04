// src/modules/payment/PaymentQueryService.ts
import prisma from "../../config/dbConfig";
import { AppError } from "../../error/AppError";

import type { Prisma } from "@prisma/client";
import type { GetAllPaymentsWithDetailsDTO } from "./dto/GetAllPaymentsWithDetailsDTO";

type PaymentStatusFilter = GetAllPaymentsWithDetailsDTO["status"];

// Ajuste aqui se teu schema tiver outros status
export type InternalPaymentStatus = "PAID" | "PENDING" | "CANCELED";

export class PaymentQueryService {
    private buildWhere(status?: PaymentStatusFilter): Prisma.PaymentWhereInput {
        const where: Prisma.PaymentWhereInput = {};

        if (status) {
            where.status = status as any;
        }

        return where;
    }

    public async getAllPaymentsWithDetails(dto: GetAllPaymentsWithDetailsDTO) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 10;

        if (page < 1) throw new AppError("page deve ser >= 1", 400);
        if (pageSize < 1 || pageSize > 100) {
            throw new AppError("pageSize deve estar entre 1 e 100", 400);
        }

        const where = this.buildWhere(dto.status);

        const total = await prisma.payment.count({ where });

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const skip = (page - 1) * pageSize;

        const items = await prisma.payment.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: pageSize,
            include: {
                user: true,
                plan: true,
                coupon: true,
            },
        });

        return {
            page,
            pageSize,
            total,
            totalPages,
            items,
        };
    }

    public async getPaymentDetailsById(paymentId: number) {
        if (!Number.isFinite(paymentId) || paymentId <= 0) {
            throw new AppError("Invalid payment ID", 400);
        }

        const payment = await prisma.payment.findUnique({
            where: { id: paymentId },
            include: {
                user: true,
                plan: true,
                coupon: true,
            },
        });

        return payment;
    }

    public async updatePaymentStatus(
        paymentId: number,
        status: InternalPaymentStatus,
    ): Promise<void> {
        if (!Number.isFinite(paymentId) || paymentId <= 0) {
            throw new AppError("Invalid payment ID", 400);
        }

        if (status !== "PAID" && status !== "PENDING" && status !== "CANCELED") {
            throw new AppError("Invalid payment status", 400);
        }

        try {
            await prisma.payment.update({
                where: { id: paymentId },
                data: {
                    status: status as any,
                    updatedAt: new Date(),
                },
            });
        } catch (err) {
            // Prisma geralmente lança erro quando não encontra registro no update
            throw new AppError("Payment not found", 404);
        }
    }
}
