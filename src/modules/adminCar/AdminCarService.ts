// src/modules/adminCar/AdminCarService.ts

import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { AdminUpdateCarDTO } from "./dto/AdminUpdateCarDTO";
import type { SubscriptionLifecycleService } from "../payment/SubscriptionLifecycleService";

type EnsureContext = "ACTIVATE_CAR" | "REACTIVATE_BY_PLATE" | "UPDATE_CAR";

export class AdminCarService {
    constructor(
        private readonly userCarRepository: IUserCarRepository,
        private readonly subscriptionRepository: ISubscriptionRepository,
        private readonly subscriptionLifecycleService?: SubscriptionLifecycleService,
    ) {}

    private normalizeLicensePlate(licensePlate: string): string {
        return (licensePlate ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    private assertValidUserId(userId: number): void {
        if (!Number.isFinite(userId) || userId <= 0) {
            throw new AppError("userId inválido", 400);
        }
    }

    private async ensureSubscriptionBestEffort(
        userId: number,
        carId: number,
        context: EnsureContext,
    ): Promise<void> {
        if (!this.subscriptionLifecycleService) return;

        try {
            await this.subscriptionLifecycleService.ensureSubscriptionWhenCarAdded(
                userId,
                carId,
            );
        } catch (err: any) {
            console.warn(
                `[AdminCarService] ensureSubscriptionWhenCarAdded failed: context=${context} userId=${userId} carId=${carId}`,
                err?.message || err,
            );
        }
    }

    // ---------------------------------------------------------------------
    // GETs
    // ---------------------------------------------------------------------

    public async getCarByPlate(
        licensePlate: string,
        includeInactive = true,
    ): Promise<UserCar> {
        const plate = this.normalizeLicensePlate(licensePlate);
        if (!plate) throw new AppError("Placa inválida", 400);

        const cars = await this.userCarRepository.findManyByLicensePlate(
            plate,
            includeInactive,
        );

        if (!cars || cars.length === 0) {
            throw new AppError("Carro não encontrado para essa placa", 404);
        }

        if (cars.length > 1) {
            throw new AppError(
                "Mais de um carro encontrado para essa placa. Informe o usuário (userId) ou use a busca por placa + userId.",
                409,
            );
        }

        return cars[0];
    }

    public async getCarByPlateAndUserId(
        licensePlate: string,
        userId: number,
        includeInactive = true,
    ): Promise<UserCar> {
        const plate = this.normalizeLicensePlate(licensePlate);
        if (!plate) throw new AppError("Placa inválida", 400);

        this.assertValidUserId(userId);

        const car = await this.userCarRepository.findByLicensePlateAndUserId(
            plate,
            userId,
            includeInactive,
        );

        if (!car) throw new AppError("Carro não encontrado para essa placa e usuário", 404);
        return car;
    }

    // ---------------------------------------------------------------------
    // Ativar / Desativar (para painel)
    // ---------------------------------------------------------------------

    public async activateCar(carId: number): Promise<UserCar> {
        const car = await this.userCarRepository.findById(carId, true);
        if (!car) throw new AppError("Carro não encontrado", 404);

        const updated = await this.userCarRepository.update(car.id, { deletedAt: null } as any);

        await this.ensureSubscriptionBestEffort(updated.userId, updated.id, "ACTIVATE_CAR");
        return updated;
    }

    public async deactivateCar(carId: number): Promise<UserCar> {
        const car = await this.userCarRepository.findById(carId, true);
        if (!car) throw new AppError("Carro não encontrado", 404);

        await this.assertCanDeactivateCar(car);

        return await this.userCarRepository.update(car.id, { deletedAt: new Date() } as any);
    }

    public async reactivateCarByPlateAndUserId(
        licensePlate: string,
        userId: number,
    ): Promise<UserCar> {
        const car = await this.getCarByPlateAndUserId(licensePlate, userId, true);

        const updated = await this.userCarRepository.update(car.id, { deletedAt: null } as any);

        await this.ensureSubscriptionBestEffort(updated.userId, updated.id, "REACTIVATE_BY_PLATE");
        return updated;
    }

    // ---------------------------------------------------------------------
    // Update completo (placa / transfer / isActive)
    // ---------------------------------------------------------------------

    public async updateCar(data: AdminUpdateCarDTO): Promise<UserCar> {
        const car = await this.userCarRepository.findById(data.id, true);
        if (!car) throw new AppError("Carro não encontrado", 404);

        const targetUserId = this.resolveTargetUserId(data, car.userId);

        const normalizedIncomingPlate = await this.resolveNormalizedIncomingPlate(
            data,
            targetUserId,
            car.id,
        );

        const deletedAt = await this.resolveDeletedAtForAdminUpdate(data, car);

        const updatePayload = this.buildUpdatePayload({
            targetUserId,
            normalizedIncomingPlate,
            deletedAt,
            data,
        });

        const updated = await this.userCarRepository.update(car.id, updatePayload as any);

        if (this.shouldEnsureSubscription(data, normalizedIncomingPlate)) {
            await this.ensureSubscriptionBestEffort(updated.userId, updated.id, "UPDATE_CAR");
        }

        return updated;
    }

    // ---------------------------------------------------------------------
    // Helpers (reduz complexidade)
    // ---------------------------------------------------------------------

    private resolveTargetUserId(data: AdminUpdateCarDTO, fallbackUserId: number): number {
        const target =
            data.userId !== undefined && data.userId !== null
                ? Number(data.userId)
                : fallbackUserId;

        this.assertValidUserId(target);
        return target;
    }

    private async resolveNormalizedIncomingPlate(
        data: AdminUpdateCarDTO,
        targetUserId: number,
        currentCarId: number,
    ): Promise<string | undefined> {
        if (data.licensePlate === undefined) return undefined;

        const normalized = this.normalizeLicensePlate(data.licensePlate);
        if (!normalized || normalized.length !== 7) throw new AppError("Placa inválida", 400);

        const conflict = await this.userCarRepository.findByLicensePlateAndUserId(
            normalized,
            targetUserId,
            true,
        );

        if (conflict && conflict.id !== currentCarId) {
            throw new AppError(
                "Já existe um carro cadastrado com esta placa para este usuário. Se ele estiver desativado, reative-o no painel.",
                409,
            );
        }

        return normalized;
    }

    private async resolveDeletedAtForAdminUpdate(
        data: AdminUpdateCarDTO,
        car: UserCar,
    ): Promise<Date | null | undefined> {
        // ✅ evita warning “can be simplified...” e mantém claro:
        if (data.isActive === undefined) return undefined;

        if (data.isActive) {
            return null;
        }

        await this.assertCanDeactivateCar(car);
        return new Date();
    }

    private async assertCanDeactivateCar(car: UserCar): Promise<void> {
        const subByUserAndCar = await this.subscriptionRepository.findByUserAndCar(
            car.userId,
            car.id,
        );

        if (subByUserAndCar?.isActive) {
            throw new AppError("Este veículo possui um plano ativo. Não é possível desativar.", 400);
        }

        if (!car.licensePlate) return;

        const subByPlate = await this.subscriptionRepository.findByCarLicensePlateAndUserId(
            car.licensePlate,
            car.userId,
        );

        if (subByPlate?.isActive) {
            throw new AppError("Este veículo possui um plano ativo. Não é possível desativar.", 400);
        }
    }

    private buildUpdatePayload(params: {
        targetUserId: number;
        normalizedIncomingPlate?: string;
        deletedAt?: Date | null;
        data: AdminUpdateCarDTO;
    }): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.normalizedIncomingPlate !== undefined) {
            payload.licensePlate = params.normalizedIncomingPlate;
        }

        if (params.deletedAt !== undefined) {
            payload.deletedAt = params.deletedAt;
        }

        if (params.data.userId !== undefined && params.data.userId !== null) {
            payload.userId = params.targetUserId;
        }

        return payload;
    }

    private shouldEnsureSubscription(
        data: AdminUpdateCarDTO,
        normalizedIncomingPlate?: string,
    ): boolean {
        const isActivating = data.isActive === true;
        const changedPlate = normalizedIncomingPlate !== undefined;
        const transferring = data.userId !== undefined && data.userId !== null;

        return isActivating || changedPlate || transferring;
    }
}
