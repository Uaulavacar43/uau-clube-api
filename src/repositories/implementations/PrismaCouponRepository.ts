import type {
    Coupon as PCoupon,
    Plan as PPlan,
    WashService as PWashService,
    Prisma,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Coupon } from "../../entities/Coupon";
import { type PeriodicityType, Plan } from "../../entities/Plan";
import { WashService } from "../../entities/WashService";
import { AppError } from "../../error/AppError";
import type { CreateCouponDTO } from "../../modules/coupon/dto/CreateCouponDTO";
import type { UpdateCouponDTO } from "../../modules/coupon/dto/UpdateCouponDTO";
import type { CouponInclude, ICouponRepository } from "../interfaces/ICouponRepository";

interface PrismaCoupon extends PCoupon {
    plans?: PPlan[];
    services?: PWashService[];
}

export class PrismaCouponRepository implements ICouponRepository {
    async create(data: CreateCouponDTO): Promise<Coupon> {
        const existingCoupon = await this.findByCode(data.code);
        if (existingCoupon) {
            throw new AppError("Já existe um cupom com este código", 400);
        }

        const coupon = await prisma.coupon.create({
            data: {
                code: data.code,
                description: data.description ?? "",

                // ✅ additionalInfo é String? no schema -> aqui é string | null
                additionalInfo: data.additionalInfo ?? null,

                discountType: data.discountType,
                discountValue: Number(data.discountValue),

                maxDiscountValue:
                    data.maxDiscountValue !== undefined && data.maxDiscountValue !== null
                        ? Number(data.maxDiscountValue)
                        : null,

                validFrom: new Date(data.validFrom),
                validUntil: new Date(data.validUntil),

                usageLimit:
                    data.usageLimit !== undefined && data.usageLimit !== null
                        ? Number(data.usageLimit)
                        : null,

                plans:
                    data.planIds !== undefined
                        ? { connect: data.planIds.map((id) => ({ id })) }
                        : undefined,

                services:
                    data.serviceIds !== undefined
                        ? { connect: data.serviceIds.map((id) => ({ id })) }
                        : undefined,
            },
            include: {
                plans: true,
                services: true,
            },
        });

        return this.mapCoupon(coupon as PrismaCoupon);
    }

    async findById(id: number, include?: CouponInclude): Promise<Coupon | null> {
        const coupon = await prisma.coupon.findUnique({
            where: { id },
            include,
        });

        return coupon ? this.mapCoupon(coupon as PrismaCoupon) : null;
    }

    async findByCode(code: string): Promise<Coupon | null> {
        const coupon = await prisma.coupon.findFirst({
            where: {
                code: {
                    equals: code,
                    mode: "insensitive",
                },
            },
            include: {
                plans: true,
                services: true,
            },
        });

        return coupon ? this.mapCoupon(coupon as PrismaCoupon) : null;
    }

    async findAll(): Promise<Coupon[]> {
        const coupons = await prisma.coupon.findMany({
            include: {
                plans: true,
                services: true,
            },
        });

        return coupons.map((coupon: PrismaCoupon) => this.mapCoupon(coupon));
    }

    async update(id: number, data: UpdateCouponDTO): Promise<Coupon> {
        const existingCoupon = await this.findById(id);
        if (!existingCoupon) {
            throw new AppError("Cupom não encontrado", 404);
        }

        if (data.code !== undefined && data.code !== existingCoupon.code) {
            const existingCode = await this.findByCode(data.code);
            if (existingCode) {
                throw new AppError("Já existe um cupom com este código", 400);
            }
        }

        // ✅ Evita o TS2322 de union/spread criando um objeto tipado e atribuindo campo a campo
        const updateData: Prisma.CouponUpdateInput = {};

        if (data.code !== undefined) {
            updateData.code = data.code;
        }

        if (data.description !== undefined) {
            updateData.description = data.description;
        }

        // ✅ additionalInfo é String? -> string | null
        // Se você quiser permitir "limpar" explicitamente com null, seu DTO precisa aceitar null.
        // Do jeito que está (z.string().optional()), aqui só aceita string.
        if (data.additionalInfo !== undefined) {
            updateData.additionalInfo = data.additionalInfo;
        }

        if (data.discountType !== undefined) {
            updateData.discountType = data.discountType;
        }

        if (data.discountValue !== undefined && data.discountValue !== null) {
            updateData.discountValue = Number(data.discountValue);
        }

        if (data.maxDiscountValue !== undefined) {
            updateData.maxDiscountValue =
                data.maxDiscountValue === null ? null : Number(data.maxDiscountValue);
        }

        if (data.validFrom !== undefined) {
            updateData.validFrom = new Date(data.validFrom);
        }

        if (data.validUntil !== undefined) {
            updateData.validUntil = new Date(data.validUntil);
        }

        if (data.usageLimit !== undefined) {
            updateData.usageLimit = data.usageLimit === null ? null : Number(data.usageLimit);
        }

        if (typeof data.isActive === "boolean") {
            updateData.isActive = data.isActive;
        }

        // ✅ Relações: só mexe se o campo foi enviado
        // - Se enviar []: limpa tudo
        // - Se enviar [1,2]: substitui por esses
        // - Se não enviar: não altera nada
        if (data.planIds !== undefined) {
            updateData.plans = {
                set: [],
                connect: data.planIds.map((pid) => ({ id: pid })),
            };
        }

        if (data.serviceIds !== undefined) {
            updateData.services = {
                set: [],
                connect: data.serviceIds.map((sid) => ({ id: sid })),
            };
        }

        const updatedCoupon = await prisma.coupon.update({
            where: { id },
            data: updateData,
            include: {
                plans: true,
                services: true,
            },
        });

        return this.mapCoupon(updatedCoupon as PrismaCoupon);
    }

    async delete(id: number): Promise<void> {
        await prisma.coupon.delete({
            where: { id },
        });
    }

    async incrementUsage(id: number): Promise<void> {
        await prisma.coupon.update({
            where: { id },
            data: {
                currentUsage: {
                    increment: 1,
                },
            },
        });
    }

    isCouponValid(coupon: Coupon): boolean {
        return (
            coupon.isActive &&
            !this.isExpired(coupon) &&
            !this.isNotStarted(coupon) &&
            !this.hasReachedUsageLimit(coupon)
        );
    }

    hasReachedUsageLimit(coupon: Coupon): boolean {
        if (!coupon.usageLimit) return false;
        return coupon.currentUsage >= coupon.usageLimit;
    }

    isExpired(coupon: Coupon): boolean {
        return new Date() > coupon.validUntil;
    }

    isNotStarted(coupon: Coupon): boolean {
        return new Date() < coupon.validFrom;
    }

    private mapCoupon(coupon: PrismaCoupon): Coupon {
        let plans: Plan[] | undefined;
        let services: WashService[] | undefined;

        if (coupon.plans) {
            plans = coupon.plans.map(
                (plan) =>
                    new Plan({
                        ...plan,
                        periodicityType: plan.periodicityType as PeriodicityType,
                    }),
            );
        }

        if (coupon.services) {
            services = coupon.services.map(
                (service) =>
                    new WashService(
                        service.id,
                        service.name,
                        service.price,
                        service.imageUrl,
                        service.isAvailable,
                        service.isPublished,
                        service.adminId,
                    ),
            );
        }

        return new Coupon(
            coupon.id,
            coupon.code,
            coupon.description,
            coupon.discountType,
            coupon.discountValue,
            coupon.validFrom,
            coupon.validUntil,
            coupon.isActive,
            coupon.currentUsage,
            coupon.createdAt,
            coupon.updatedAt,
            // ✅ additionalInfo é string? -> no domain você decide se quer null ou undefined
            // Aqui eu mantenho undefined quando null
            coupon.additionalInfo ?? undefined,
            coupon.maxDiscountValue ?? undefined,
            coupon.usageLimit ?? undefined,
            plans,
            services,
        );
    }
}
