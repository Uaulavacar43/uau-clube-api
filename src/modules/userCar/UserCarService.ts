// src/modules/userCar/UserCarService.ts

import type { User } from "../../entities/User";
import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";

// ✅ novo serviço (best-effort) no lugar do PaymentService arquivado
// ajuste o caminho se no teu projeto estiver em /payment/services/...
import type { SubscriptionLifecycleService } from "../payment/SubscriptionLifecycleService";

type RegisterCarResult = {
    car: UserCar;
    created: boolean;
};

export class UserCarService {
    constructor(
        private readonly userCarRepository: IUserCarRepository,
        private readonly subscriptionRepository: ISubscriptionRepository,

        /**
         * Opcional: não deve quebrar cadastro/edição de carro se falhar.
         * Serve para reconciliar assinatura quando adiciona carro.
         */
        private readonly subscriptionLifecycleService?: SubscriptionLifecycleService,
    ) {}

    private normalizeLicensePlate(licensePlate: string): string {
        return (licensePlate ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    private isPrivilegedRole(role?: string): boolean {
        return role === "ADMIN" || role === "MANAGER";
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * ✅ Retry por (placa + userId), porque a unicidade é por usuário.
     */
    private async findByLicensePlateWithRetry(
        licensePlate: string,
        userId: number,
        includeInactive = false,
    ): Promise<UserCar | null> {
        const attempts = [0, 40, 80, 120, 160, 200];

        for (let i = 0; i < attempts.length; i++) {
            const wait = attempts[i];
            if (wait > 0) await this.sleep(wait);

            const car = await this.userCarRepository.findByLicensePlateAndUserId(
                licensePlate,
                userId,
                includeInactive,
            );
            if (car) return car;
        }

        return null;
    }

    private async ensureSubscriptionBestEffort(
        userId: number,
        carId: number,
        context: string,
    ): Promise<void> {
        if (!this.subscriptionLifecycleService) return;

        try {
            await this.subscriptionLifecycleService.ensureSubscriptionWhenCarAdded(userId, carId);
        } catch (err: any) {
            // best effort: não quebra o fluxo do usuário
            console.warn(
                `[UserCarService] ensureSubscriptionWhenCarAdded falhou (best-effort). context=${context} userId=${userId} carId=${carId}`,
                err?.message || err,
            );
        }
    }

    public async registerCar(
        data: RegisterUserCarDTO,
        userId: number,
        actor?: Pick<User, "id" | "role">,
    ): Promise<RegisterCarResult> {
        const normalizedPlate = this.normalizeLicensePlate(data.licensePlate);
        if (!normalizedPlate) throw new AppError("Placa inválida", 400);

        const dtoUserId = data.userId;
        let resolvedUserId = userId;

        // Admin/Manager pode registrar para outro user
        if (dtoUserId !== undefined && dtoUserId !== null) {
            if (dtoUserId !== userId) {
                if (!this.isPrivilegedRole(actor?.role)) {
                    throw new AppError(
                        "Você não está autorizado a registrar veículo para outro usuário",
                        403,
                    );
                }
                resolvedUserId = dtoUserId;
            }
        }

        // não deixa DTO sobrescrever
        const { userId: _ignoredDtoUserId, licensePlate: _ignoredPlate, ...restData } = data;

        /**
         * ✅ busca por (placa + userId), incluindo inativos
         * (evita P2002 e deixa idempotente)
         */
        const existingCar = await this.userCarRepository.findByLicensePlateAndUserId(
            normalizedPlate,
            resolvedUserId,
            true,
        );

        if (existingCar) {
            await this.ensureSubscriptionBestEffort(
                resolvedUserId,
                existingCar.id,
                "EXISTING_PLATE_IDEMPOTENT",
            );
            return { car: existingCar, created: false };
        }

        try {
            const createdCar = await this.userCarRepository.create({
                ...restData,
                licensePlate: normalizedPlate,
                userId: resolvedUserId,
            });

            await this.ensureSubscriptionBestEffort(
                resolvedUserId,
                createdCar.id,
                "CREATED_NEW_CAR",
            );

            return { car: createdCar, created: true };
        } catch (error: any) {
            if (error && typeof error === "object" && "code" in error && (error as any).code === "P2002") {
                // corrida: outra transação pode ter criado a MESMA placa para o MESMO usuário
                const carAfterError = await this.findByLicensePlateWithRetry(
                    normalizedPlate,
                    resolvedUserId,
                    true,
                );

                if (carAfterError) {
                    await this.ensureSubscriptionBestEffort(
                        resolvedUserId,
                        carAfterError.id,
                        "P2002_FETCHED_EXISTING",
                    );
                    return { car: carAfterError, created: false };
                }

                throw new AppError(
                    "Já existe um veículo registrado com esta placa para este usuário",
                    409,
                );
            }

            throw error;
        }
    }

    public async listCars(userId: number): Promise<UserCar[]> {
        return await this.userCarRepository.findByUserId(userId);
    }

    public async updateCar(
        data: UpdateUserCarDTO,
        user: Pick<User, "id" | "role">,
    ): Promise<UserCar> {
        const existingCar = await this.userCarRepository.findById(data.id, true);
        if (!existingCar) throw new AppError("Carro não encontrado", 404);

        const isPrivileged = this.isPrivilegedRole(user.role);

        if (!isPrivileged && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a atualizar este carro", 403);
        }

        const updateData: UpdateUserCarDTO = { ...data };

        // não permite transferir userId aqui (admin faz isso em AdminCarService)
        if ("userId" in (updateData as any)) {
            delete (updateData as any).userId;
        }

        // placa: só admin/manager pode mudar
        if ((updateData as any).licensePlate !== undefined) {
            const incoming = this.normalizeLicensePlate((updateData as any).licensePlate);
            const current = existingCar.licensePlate
                ? this.normalizeLicensePlate(existingCar.licensePlate)
                : "";

            if (!incoming) throw new AppError("Placa inválida", 400);

            if (!isPrivileged) {
                // usuário comum não troca placa
                if (incoming !== current) {
                    throw new AppError("Apenas administradores ou gerentes podem atualizar a placa", 403);
                }
                delete (updateData as any).licensePlate;
            } else {
                // admin/manager: se mudou, checa colisão por (placa + userId)
                if (incoming !== current) {
                    const conflict = await this.userCarRepository.findByLicensePlateAndUserId(
                        incoming,
                        existingCar.userId,
                        true,
                    );

                    if (conflict && conflict.id !== existingCar.id) {
                        throw new AppError(
                            "Já existe um veículo registrado com esta placa para este usuário",
                            409,
                        );
                    }
                }

                (updateData as any).licensePlate = incoming;
            }
        }

        try {
            return await this.userCarRepository.update(existingCar.id, updateData);
        } catch (error: any) {
            if (error && typeof error === "object" && "code" in error && (error as any).code === "P2002") {
                // P2002 agora = colisão de placa para ESTE userId
                throw new AppError("Já existe um veículo registrado com esta placa para este usuário", 409);
            }
            throw error;
        }
    }

    public async deleteCar(
        carId: number,
        user: Pick<User, "id" | "role">,
    ): Promise<void> {
        const existingCar = await this.userCarRepository.findById(carId, true);
        if (!existingCar) throw new AppError("Carro não encontrado", 404);

        const isPrivileged = this.isPrivilegedRole(user.role);

        if (!isPrivileged && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a excluir este carro", 403);
        }

        // regra: não deletar se existir plano ativo
        const subscriptionByUserAndCar = await this.subscriptionRepository.findByUserAndCar(
            existingCar.userId,
            existingCar.id,
        );

        if (subscriptionByUserAndCar?.isActive) {
            throw new AppError("Este veículo possui um plano ativo", 400);
        }

        // ✅ por placa + userId (nova regra)
        if (existingCar.licensePlate) {
            const subscriptionByPlate =
                await this.subscriptionRepository.findByCarLicensePlateAndUserId(
                    existingCar.licensePlate,
                    existingCar.userId,
                );

            if (subscriptionByPlate?.isActive) {
                throw new AppError("Este veículo possui um plano ativo", 400);
            }
        }

        await this.userCarRepository.delete(carId);
    }
}
