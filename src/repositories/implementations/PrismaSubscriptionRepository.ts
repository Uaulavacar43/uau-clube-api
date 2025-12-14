import type {
    Car as PrismaCar,
    Coupon as PrismaCoupon,
    Plan as PrismaPlan,
    Subscription as PrismaSubscription,
} from "@prisma/client";
import prisma from "../../config/dbConfig";
import { Coupon } from "../../entities/Coupon";
import { PeriodicityType, Plan } from "../../entities/Plan";
import { Subscription, type SubscriptionStatus } from "../../entities/Subscription";
import { UserCar } from "../../entities/UserCar";
import type { ISubscriptionRepository } from "../interfaces/ISubscriptionRepository";

export class PrismaSubscriptionRepository implements ISubscriptionRepository {
    private normalizePlate(value: string): string {
        return (value ?? "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    }

    public async findByUserAndCar(userId: number, carId: number): Promise<Subscription | null> {
        const subscription = await prisma.subscription.findFirst({
            where: { userId, carId },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });
        if (!subscription) return null;
        return this.mapToEntity(subscription);
    }

    public async findById(id: number, includeCars = false): Promise<Subscription | null> {
        const subscription = await prisma.subscription.findUnique({
            where: { id },
            include: {
                car: includeCars,
                plan: true,
                coupon: true,
            },
        });
        if (!subscription) return null;
        return this.mapToEntity(subscription);
    }

    public async findByUserId(userId: number, includeCars = false): Promise<Subscription[]> {
        const subscriptions = await prisma.subscription.findMany({
            where: {
                userId,
                isActive: true,
            },
            include: {
                car: includeCars,
                plan: true,
                coupon: true,
            },
        });
        return subscriptions.map(this.mapToEntity.bind(this));
    }

    public async findByCarLicensePlate(licensePlate: string): Promise<Subscription | null> {
        const normalized = this.normalizePlate(licensePlate);

        if (!normalized) return null;

        const car = await prisma.car.findFirst({
            where: { licensePlate: normalized, deletedAt: null },
            select: { id: true },
        });
        if (!car) return null;

        const subscription = await prisma.subscription.findFirst({
            where: { carId: car.id, isActive: true },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });
        if (!subscription) return null;

        return this.mapToEntity(subscription);
    }

    /**
     * CORREÇÃO: respeitar startDate vindo da entidade (não sobrescrever sempre com new Date()).
     * Isso impacta validade, expiração e consistência de relatórios.
     */
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
            startDate,
            installmentIdAsaas,
            subscriptionStatus,
        } = data;

        const createdSubscription = await prisma.subscription.create({
            data: {
                userId,
                carId,
                planId,
                planType,
                amount,
                paymentMethod,
                startDate: startDate ?? new Date(),
                endDate,
                expiresAt,
                isActive,
                subscriptionIdAsaas,
                installmentIdAsaas,
                couponId,
                subscriptionStatus,
            },
            include: {
                car: true,
                plan: true,
                coupon: true,
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
            data: {
                userId: data.userId,
                carId: data.carId,
                planId: data.planId,
                planType: data.planType,
                amount: data.amount,
                paymentMethod: data.paymentMethod,
                startDate: data.startDate,
                endDate: data.endDate,
                // Evite alterar createdAt via update, mas mantive conforme seu código
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                expiresAt: data.expiresAt,
                subscriptionIdAsaas: data.subscriptionIdAsaas,
                installmentIdAsaas: data.installmentIdAsaas,
                couponId: data.couponId,
                isActive: data.isActive,
                subscriptionStatus: data.subscriptionStatus,
            },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });

        return this.mapToEntity(updatedSubscription);
    }

    /**
     * CORREÇÃO: ao cancelar, além de isActive=false, marcar subscriptionStatus=CANCELED.
     * Isso evita o sistema “interpretar” como SUSPENDED e reativar indevidamente via regras.
     */
    public async cancel(subscriptionId: number): Promise<void> {
        await prisma.subscription.update({
            where: { id: subscriptionId },
            data: {
                isActive: false,
                endDate: new Date(),
                subscriptionStatus: "CANCELED",
                updatedAt: new Date(),
            },
        });
    }

    public async getByAsaasId(subscriptionIdAsaas: string): Promise<Subscription | null> {
        const result = await prisma.subscription.findFirst({
            where: { subscriptionIdAsaas },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });
        return result ? this.mapToEntity(result) : null;
    }

    public async getByInstallmentIdAsaas(installmentIdAsaas: string): Promise<Subscription | null> {
        const result = await prisma.subscription.findFirst({
            where: { installmentIdAsaas },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });
        return result ? this.mapToEntity(result) : null;
    }

    /**
     * CORREÇÃO: cancelar por asaasId também deve marcar subscriptionStatus=CANCELED,
     * e setar endDate para rastreabilidade.
     */
    public async cancelByAsaasId(subscriptionIdAsaas: string): Promise<void> {
        await prisma.subscription.updateMany({
            where: { subscriptionIdAsaas },
            data: {
                isActive: false,
                subscriptionStatus: "CANCELED",
                endDate: new Date(),
                updatedAt: new Date(),
            },
        });
    }

    /** Retorna a primeira assinatura ativa do usuário. */
    public async getActiveSubscriptionByUserId(userId: number): Promise<Subscription | null> {
        const result = await prisma.subscription.findFirst({
            where: {
                userId,
                isActive: true,
            },
            include: {
                car: true,
                plan: true,
                coupon: true,
            },
        });
        return result ? this.mapToEntity(result) : null;
    }

    private normalizePlanType(raw: string): PeriodicityType {
        switch (raw) {
            case PeriodicityType.WEEK:
            case "WEEKLY":
                return PeriodicityType.WEEK;

            case PeriodicityType.MONTH:
            case "MONTHLY":
                return PeriodicityType.MONTH;

            case PeriodicityType.QUARTERLY:
                return PeriodicityType.QUARTERLY;

            case PeriodicityType.SEMIANNUALLY:
                return PeriodicityType.SEMIANNUALLY;

            case PeriodicityType.YEAR:
            case "YEARLY":
                return PeriodicityType.YEAR;

            default:
                return PeriodicityType.MONTH;
        }
    }

    /**
     * CORREÇÃO: preservar subscriptionStatus do banco quando existir.
     * Se não existir (null/undefined), usar fallback baseado em isActive.
     */
    private normalizeSubscriptionStatus(
        raw: any,
        fallbackIsActive: boolean,
    ): SubscriptionStatus {
        if (raw === "ACTIVE" || raw === "SUSPENDED" || raw === "CANCELED") {
            return raw as SubscriptionStatus;
        }
        return fallbackIsActive ? "ACTIVE" : "SUSPENDED";
    }

    private mapToEntity(
        subscription: PrismaSubscription & {
            car?: PrismaCar | null;
            plan?: PrismaPlan | null;
            coupon?: PrismaCoupon | null;
        },
    ): Subscription {
        const normalizedPlanType = this.normalizePlanType(subscription.planType as string);

        const subscriptionStatus: SubscriptionStatus = this.normalizeSubscriptionStatus(
            (subscription as any).subscriptionStatus,
            subscription.isActive,
        );

        return new Subscription({
            id: subscription.id,
            userId: subscription.userId,
            carId: subscription.carId ?? undefined,
            planId: subscription.planId ?? undefined,
            planType: normalizedPlanType,
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
                    subscription.car.licensePlate,
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
                    periodicityType: subscription.plan.periodicityType as PeriodicityType,
                    isPackage: subscription.plan.isPackage,
                    createdAt: subscription.plan.createdAt,
                    updatedAt: subscription.plan.updatedAt,
                }),

            subscriptionStatus,
        });
    }
}
