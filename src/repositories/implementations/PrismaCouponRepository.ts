import type {
	Coupon as PCoupon,
	Plan as PPlan,
	WashService as PWashService,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Coupon } from "../../entities/Coupon";
import { type PeriodicityType, Plan } from "../../entities/Plan";
import { WashService } from "../../entities/WashService";
import { AppError } from "../../error/AppError";
import type { CreateCouponDTO } from "../../modules/coupon/dto/CreateCouponDTO";
import type { UpdateCouponDTO } from "../../modules/coupon/dto/UpdateCouponDTO";
import type {
	CouponInclude,
	ICouponRepository,
} from "../interfaces/ICouponRepository";

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
				additionalInfo: data.additionalInfo,
				discountType: data.discountType,
				discountValue: Number(data.discountValue),
				maxDiscountValue: data.maxDiscountValue
					? Number(data.maxDiscountValue)
					: null,
				validFrom: new Date(data.validFrom),
				validUntil: new Date(data.validUntil),
				usageLimit: data.usageLimit ? Number(data.usageLimit) : null,
				plans: data.planIds
					? { connect: data.planIds.map((id) => ({ id })) }
					: undefined,
				services: data.serviceIds
					? { connect: data.serviceIds.map((id) => ({ id })) }
					: undefined,
			},
		});

		return this.mapCoupon(coupon);
	}

	async findById(id: number, include?: CouponInclude): Promise<Coupon | null> {
		const coupon = await prisma.coupon.findUnique({
			where: { id },
			include,
		});
		return coupon ? this.mapCoupon(coupon) : null;
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
		return coupon ? this.mapCoupon(coupon) : null;
	}

	async findAll(): Promise<Coupon[]> {
		const coupons = await prisma.coupon.findMany();
		return coupons.map((coupon: PrismaCoupon) => this.mapCoupon(coupon));
	}

	async update(id: number, data: UpdateCouponDTO): Promise<Coupon> {
		const existingCoupon = await this.findById(id);
		if (!existingCoupon) {
			throw new AppError("Cupom não encontrado", 404);
		}

		if (data.code && data.code !== existingCoupon.code) {
			const existingCode = await this.findByCode(data.code);
			if (existingCode) {
				throw new AppError("Já existe um cupom com este código", 400);
			}
		}

		const updatedCoupon = await prisma.coupon.update({
			where: { id },
			data: {
				...(data.code && { code: data.code }),
				...(data.description && { description: data.description }),
				...(data.additionalInfo && { additionalInfo: data.additionalInfo }),
				...(data.discountType && { discountType: data.discountType }),
				...(data.discountValue && {
					discountValue: Number(data.discountValue),
				}),
				...(data.maxDiscountValue && {
					maxDiscountValue: Number(data.maxDiscountValue),
				}),
				...(data.validFrom && { validFrom: new Date(data.validFrom) }),
				...(data.validUntil && { validUntil: new Date(data.validUntil) }),
				...(data.usageLimit && { usageLimit: Number(data.usageLimit) }),
				...(typeof data.isActive === "boolean" && { isActive: data.isActive }),
				...(data.planIds
					? { plans: { set: [], connect: data.planIds.map((id) => ({ id })) } }
					: { plans: { set: [] } }),
				...(data.serviceIds
					? {
							services: {
								set: [],
								connect: data.serviceIds.map((id) => ({ id })),
							},
						}
					: { services: { set: [] } }),
			},
		});

		return this.mapCoupon(updatedCoupon);
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
			coupon.additionalInfo || undefined,
			coupon.maxDiscountValue || undefined,
			coupon.usageLimit || undefined,
			plans,
			services,
		);
	}
}
