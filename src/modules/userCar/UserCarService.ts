import type { User } from "../../entities/User";
import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";
import { PaymentService } from "../payment/PaymentService";

type RegisterCarResult = {
    car: UserCar;
    created: boolean;
};

export class UserCarService {
    constructor(
        private userCarRepository: IUserCarRepository,
        private subscriptionRepository: ISubscriptionRepository,
        private paymentService?: PaymentService,
    ) {}

    private normalizeLicensePlate(licensePlate: string): string {
        if (!licensePlate) return licensePlate;
        return (licensePlate ?? "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    }

    private isPrivilegedRole(role?: string): boolean {
        return role === "ADMIN" || role === "MANAGER";
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async findByLicensePlateWithRetry(licensePlate: string): Promise<UserCar | null> {
        // 6 tentativas em ~ (0 + 40 + 80 + 120 + 160 + 200)ms = 600ms no total
        // Suficiente para “acompanhar” commit de transação concorrente no Postgres.
        const attempts = [0, 40, 80, 120, 160, 200];

        for (let i = 0; i < attempts.length; i++) {
            const wait = attempts[i];
            if (wait > 0) await this.sleep(wait);

            const car = await this.userCarRepository.findByLicensePlate(licensePlate);
            if (car) return car;
        }

        return null;
    }

    private async ensureSubscriptionSafe(userId: number, carId: number, context: string): Promise<void> {
        if (!this.paymentService) {
            console.warn(
                `[UserCarService] PaymentService não injetado; pulando vinculação automática de assinatura. Context=${context}`,
            );
            return;
        }

        try {
            await this.paymentService.ensureSubscriptionWhenCarAdded(userId, carId);
        } catch (err: any) {
            console.error(
                `[UserCarService] Falha ao garantir assinatura após registrar carro. Context=${context} userId=${userId} carId=${carId}`,
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

        const dtoUserId = data.userId;
        let resolvedUserId = userId;

        if (dtoUserId !== undefined && dtoUserId !== null) {
            if (dtoUserId !== userId) {
                if (!this.isPrivilegedRole(actor?.role)) {
                    throw new AppError(
                        "Você não está autorizado a registrar veículo para outro usuário",
                        403,
                    );
                }
                resolvedUserId = dtoUserId;
            } else {
                resolvedUserId = userId;
            }
        }

        const {
            userId: _ignoredDtoUserId,
            licensePlate: _ignoredPlate,
            ...restData
        } = data;

        const existingCar = await this.userCarRepository.findByLicensePlate(normalizedPlate);

        if (existingCar) {
            if (existingCar.userId !== resolvedUserId) {
                throw new AppError(
                    "Carro com esta placa já está vinculado a outro usuário",
                    409,
                );
            }

            await this.ensureSubscriptionSafe(resolvedUserId, existingCar.id, "EXISTING_PLATE_IDEMPOTENT");
            return { car: existingCar, created: false };
        }

        try {
            const createdCar = await this.userCarRepository.create({
                ...restData,
                licensePlate: normalizedPlate,
                userId: resolvedUserId,
            });

            await this.ensureSubscriptionSafe(resolvedUserId, createdCar.id, "CREATED_NEW_CAR");
            return { car: createdCar, created: true };
        } catch (error: any) {
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error as any).code === "P2002"
            ) {
                // Corrida real: outra transação pode ter criado a mesma placa e ainda estar commitando.
                const carAfterError = await this.findByLicensePlateWithRetry(normalizedPlate);

                if (carAfterError) {
                    if (carAfterError.userId !== resolvedUserId) {
                        throw new AppError(
                            "Carro com esta placa já está vinculado a outro usuário",
                            409,
                        );
                    }

                    await this.ensureSubscriptionSafe(resolvedUserId, carAfterError.id, "P2002_FETCHED_EXISTING");
                    return { car: carAfterError, created: false };
                }

                // Se mesmo após retry não achou, mantém 409 (não dá para afirmar owner com segurança)
                throw new AppError("Carro com esta placa já está registrado", 409);
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
        const existingCar = await this.userCarRepository.findById(data.id);
        if (!existingCar) {
            throw new AppError("Carro não encontrado", 404);
        }

        if (!this.isPrivilegedRole(user.role) && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a atualizar este carro", 403);
        }

        const updateData: UpdateUserCarDTO = { ...data };

        if ((updateData as any).licensePlate) {
            const normalizedIncoming = this.normalizeLicensePlate((updateData as any).licensePlate);
            const currentNormalized = existingCar.licensePlate
                ? this.normalizeLicensePlate(existingCar.licensePlate)
                : "";

            if (!this.isPrivilegedRole(user.role)) {
                if (normalizedIncoming !== currentNormalized) {
                    throw new AppError(
                        "Apenas administradores ou gerentes podem atualizar a placa",
                        403,
                    );
                }
                delete (updateData as any).licensePlate;
            } else {
                (updateData as any).licensePlate = normalizedIncoming;
            }
        }

        if ("userId" in (updateData as any)) {
            delete (updateData as any).userId;
        }

        try {
            return await this.userCarRepository.update(existingCar.id, updateData);
        } catch (error: any) {
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error as any).code === "P2002"
            ) {
                throw new AppError("Já existe um veículo registrado com esta placa", 409);
            }
            throw error;
        }
    }

    public async deleteCar(
        carId: number,
        user: Pick<User, "id" | "role">,
    ): Promise<void> {
        const existingCar = await this.userCarRepository.findById(carId);
        if (!existingCar) {
            throw new AppError("Carro não encontrado", 404);
        }

        if (!this.isPrivilegedRole(user.role) && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a excluir este carro", 403);
        }

        const subscriptionByUserAndCar =
            await this.subscriptionRepository.findByUserAndCar(
                existingCar.userId,
                existingCar.id,
            );

        if (subscriptionByUserAndCar?.isActive) {
            throw new AppError("Este veículo possui um plano ativo", 400);
        }

        if (existingCar.licensePlate) {
            const subscriptionByPlate =
                await this.subscriptionRepository.findByCarLicensePlate(
                    existingCar.licensePlate,
                );

            if (subscriptionByPlate?.isActive) {
                throw new AppError("Este veículo possui um plano ativo", 400);
            }
        }

        await this.userCarRepository.delete(carId);
    }
}
