// src/entities/Plan.ts

export enum PeriodicityType {
    WEEK = "WEEK",
    MONTH = "MONTH",
    QUARTERLY = "QUARTERLY",
    SEMIANNUALLY = "SEMIANNUALLY",
    YEAR = "YEAR",
}

export interface WashService {
    id: number;
    name: string;
    price: number;
    imageUrl: string;
    isAvailable: boolean;
}

interface PlanData {
    id?: number;
    name: string;
    description?: string | null;
    price: number;
    duration: number;
    isBestChoice: boolean;
    periodicityType: PeriodicityType;
    isPackage?: boolean;
    extraMonths?: number | null;
    maxInstallments?: number | null;
    createdAt?: Date;
    updatedAt?: Date;
    washServices?: WashService[];
}

export class Plan {
    public id: number;
    public name: string;
    public description?: string | null;
    public price: number;
    public duration: number;
    public isBestChoice: boolean;
    public periodicityType: PeriodicityType;
    public isPackage: boolean;
    public extraMonths: number | null;
    public maxInstallments: number | null;
    public createdAt: Date;
    public updatedAt: Date;
    public washServices: WashService[];

    constructor({
                    id,
                    name,
                    description,
                    price,
                    duration,
                    isBestChoice,
                    periodicityType,
                    isPackage,
                    extraMonths,
                    maxInstallments,
                    createdAt,
                    updatedAt,
                    washServices,
                }: PlanData) {
        this.id = id ?? 0;
        this.name = name;
        this.description = description ?? null;
        this.price = price;
        this.duration = duration;
        this.isBestChoice = isBestChoice;
        this.periodicityType = periodicityType;
        this.isPackage = isPackage ?? false;
        this.extraMonths = extraMonths ?? null;
        this.maxInstallments = maxInstallments ?? null;
        this.createdAt = createdAt ?? new Date();
        this.updatedAt = updatedAt ?? new Date();
        this.washServices = washServices ?? [];
    }
}
