// src/entities/Subscription.ts

import type { Coupon } from "./Coupon";
import { PeriodicityType, type Plan } from "./Plan";
import type { UserCar } from "./UserCar";

export type SubscriptionStatus = "ACTIVE" | "SUSPENDED" | "CANCELED";

export class Subscription {
    public id: number;
    public userId: number;
    public carId?: number;
    public planId?: number;
    public planType: PeriodicityType;
    public amount: number;
    public isActive: boolean;
    public startDate: Date;
    public endDate: Date | null;
    public createdAt: Date;
    public updatedAt: Date;
    public expiresAt: Date | null;
    public paymentMethod: string;
    public subscriptionIdAsaas: string | null;
    public installmentIdAsaas: string | null;
    public couponId?: number | null;
    public coupon?: Coupon | null;
    public car?: UserCar | null;
    public plan?: Plan | null;
    public subscriptionStatus: SubscriptionStatus;

    constructor(data: {
        id?: number;
        userId: number;
        carId?: number;
        planId?: number;
        planType: PeriodicityType;
        amount: number;
        isActive: boolean;
        startDate: Date;
        endDate?: Date | null;
        createdAt?: Date;
        updatedAt?: Date;
        expiresAt?: Date | null;
        paymentMethod: string;
        subscriptionIdAsaas?: string | null;
        installmentIdAsaas?: string | null;
        couponId?: number | null;
        coupon?: Coupon | null;
        car?: UserCar | null;
        plan?: Plan | null;
        subscriptionStatus: SubscriptionStatus;
    }) {
        this.id = data.id ?? 0;
        this.userId = data.userId;
        this.carId = data.carId;
        this.planId = data.planId;
        this.planType = data.planType;
        this.amount = data.amount;
        this.isActive = data.isActive;
        this.startDate = data.startDate;
        this.endDate = data.endDate ?? null;
        this.createdAt = data.createdAt ?? new Date();
        this.updatedAt = data.updatedAt ?? new Date();
        this.expiresAt = data.expiresAt ?? null;
        this.paymentMethod = data.paymentMethod;
        this.subscriptionIdAsaas = data.subscriptionIdAsaas ?? null;
        this.installmentIdAsaas = data.installmentIdAsaas ?? null;
        this.couponId = data.couponId ?? null;
        this.coupon = data.coupon ?? null;
        this.car = data.car ?? null;
        this.plan = data.plan ?? null;
        this.subscriptionStatus = data.subscriptionStatus;
    }
}
