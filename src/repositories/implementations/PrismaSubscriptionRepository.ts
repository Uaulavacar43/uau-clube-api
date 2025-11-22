import type {
	Car as PrismaCar,
	Coupon as PrismaCoupon,
	Plan as PrismaPlan,
	Subscription as PrismaSubscription,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Coupon } from "../../entities/Coupon";
import { type PeriodicityType, Plan } from "../../entities/Plan";
import { Subscription } from "../../entities/Subscription";
import { UserCar } from "../../entities/UserCar";
import type { ISubscriptionRepository } from "../interfaces/ISubscriptionRepository";

export class PrismaSubscriptionRepository implements ISubscriptionRepository {
	public async findByUserAndCar(
		userId: number,
		carId: number,
	): Promise<Subscription | null> {
		const subscription = await prisma.subscription.findFirst({
			where: { userId, carId },
		});
		if (!subscription) return null;
		return this.mapToEntity(subscription);
	}

	public async findById(
		id: number,
		includeCars = false,
	): Promise<Subscription | null> {
		const subscription = await prisma.subscription.findUnique({
			where: { id },
			include: {
				car: includeCars,
			},
		});
		if (!subscription) return null;
		return this.mapToEntity(subscription);
	}

	public async findByUserId(
		userId: number,
		includeCars = false,
	): Promise<Subscription[]> {
		const subscriptions = await prisma.subscription.findMany({
			where: {
				userId,
				isActive: true,
			},
			include: {
				car: includeCars,
				plan: true,
			},
		});
		return subscriptions.map(this.mapToEntity);
	}

	public async findByCarLicensePlate(
		licensePlate: string,
	): Promise<Subscription | null> {
		const car = await prisma.car.findFirst({
			where: { plate: licensePlate, deletedAt: null },
		});
		if (!car) return null;

		const subscription = await prisma.subscription.findFirst({
			where: { carId: car.id, isActive: true },
		});
		if (!subscription) return null;
		return this.mapToEntity(subscription);
	}

	public async create(data: Subscription): Promise<Subscription> {
		const {
			userId,
			carId,
			planId,
			planType,
			amount,
			paymentMethod,
			isActive,
			subscriptionIdAsaas,
			endDate,
			expiresAt,
			couponId,
		} = data;

		const startDate = new Date();

		const createdSubscription = await prisma.subscription.create({
			data: {
				userId,
				carId,
				planId,
				planType,
				amount,
				paymentMethod,
				startDate,
				endDate,
				expiresAt,
				isActive,
				subscriptionIdAsaas,
				couponId,
			},
		});

		return this.mapToEntity(createdSubscription);
	}

	public async update(
		subscriptionId: number,
		data: Partial<Omit<Subscription, "car" | "id" | "plan" | "coupon">>,
	): Promise<Subscription> {
		const updatedSubscription = await prisma.subscription.update({
			where: { id: subscriptionId },
			data,
		});
		return this.mapToEntity(updatedSubscription);
	}

	public async cancel(subscriptionId: number): Promise<void> {
		await prisma.subscription.update({
			where: { id: subscriptionId },
			data: {
				isActive: false,
				endDate: new Date(),
			},
		});
	}

	public async getByAsaasId(
		subscriptionIdAsaas: string,
	): Promise<Subscription | null> {
		const result = await prisma.subscription.findFirst({
			where: { subscriptionIdAsaas },
		});
		return result ? this.mapToEntity(result) : null;
	}

	public async getByInstallmentIdAsaas(
		installmentIdAsaas: string,
	): Promise<Subscription | null> {
		const result = await prisma.subscription.findFirst({
			where: { installmentIdAsaas },
		});
		return result ? this.mapToEntity(result) : null;
	}

	public async cancelByAsaasId(subscriptionIdAsaas: string): Promise<void> {
		await prisma.subscription.updateMany({
			where: { subscriptionIdAsaas },
			data: { isActive: false },
		});
	}

	/** NUEVO MÉTODO: Retorna la primera suscripción activa del usuario. */
	public async getActiveSubscriptionByUserId(
		userId: number,
	): Promise<Subscription | null> {
		const result = await prisma.subscription.findFirst({
			where: {
				userId,
				isActive: true,
			},
		});
		return result ? this.mapToEntity(result) : null;
	}

	private mapToEntity(
		subscription: PrismaSubscription & {
			car?: PrismaCar | null;
			plan?: PrismaPlan | null;
			coupon?: PrismaCoupon | null;
		},
	): Subscription {
		return new Subscription({
			id: subscription.id,
			userId: subscription.userId,
			carId: subscription.carId ?? undefined,
			planId: subscription.planId ?? undefined,
			planType: subscription.planType as "MONTHLY" | "YEARLY" | "WEEKLY",
			amount: subscription.amount,
			isActive: subscription.isActive,
			startDate: subscription.startDate,
			endDate: subscription.endDate ?? undefined,
			createdAt: subscription.createdAt,
			updatedAt: subscription.updatedAt,
			expiresAt: subscription.expiresAt,
			paymentMethod: subscription.paymentMethod ?? "",
			subscriptionIdAsaas: subscription.subscriptionIdAsaas,
			installmentIdAsaas: subscription.installmentIdAsaas,
			couponId: subscription.couponId,
			coupon: !subscription.coupon
				? undefined
				: new Coupon(
						subscription.coupon.id,
						subscription.coupon.code,
						subscription.coupon.description,
						subscription.coupon.discountType,
						subscription.coupon.discountValue,
						subscription.coupon.validFrom,
						subscription.coupon.validUntil,
						subscription.coupon.isActive,
						subscription.coupon.currentUsage,
						subscription.coupon.createdAt,
						subscription.coupon.updatedAt,
						subscription.coupon.additionalInfo,
						subscription.coupon.maxDiscountValue,
						subscription.coupon.usageLimit,
					),
			car: !subscription.car
				? undefined
				: new UserCar(
						subscription.car.id,
						subscription.car.plate,
						subscription.car.color,
						subscription.car.model,
						subscription.car.brand,
						subscription.car.year,
						subscription.car.userId,
					),
			plan: !subscription.plan
				? undefined
				: new Plan({
						id: subscription.plan.id,
						name: subscription.plan.name,
						description: subscription.plan.description,
						price: subscription.plan.price,
						duration: subscription.plan.duration,
						isBestChoice: subscription.plan.isBestChoice,
						periodicityType: subscription.plan
							.periodicityType as PeriodicityType,
						isPackage: subscription.plan.isPackage,
						createdAt: subscription.plan.createdAt,
						updatedAt: subscription.plan.updatedAt,
					}),
		});
	}
}
