import type { User } from "../../entities/User";
import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { RegisterUserCarDTO } from "./dto/RegisterUserCarDTO";
import type { UpdateUserCarDTO } from "./dto/UpdateUserCarDTO";
import { PaymentService } from "../payment/PaymentService";

export class UserCarService {
    constructor(
        private userCarRepository: IUserCarRepository,
        private subscriptionRepository: ISubscriptionRepository,
        private paymentService?: PaymentService,
    ) {}

    private normalizeLicensePlate(licensePlate: string): string {
        if (!licensePlate) {
            return licensePlate;
        }
        return licensePlate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    }

    public async registerCar(
        data: RegisterUserCarDTO,
        userId: number,
    ): Promise<UserCar> {
        const resolvedUserId = data.userId ?? userId;

        const normalizedPlate = this.normalizeLicensePlate(data.licensePlate);

        const { userId: _dtoUserId, licensePlate, ...restData } = data as RegisterUserCarDTO & {
            id?: number;
        };

        const existingCar = await this.userCarRepository.findByLicensePlate(
            normalizedPlate,
        );

        if (existingCar) {
            if (existingCar.userId !== resolvedUserId) {
                throw new AppError(
                    "Carro com esta placa já está vinculado a outro usuário",
                    400,
                );
            }

            if (this.paymentService) {
                await this.paymentService.ensureSubscriptionWhenCarAdded(
                    resolvedUserId,
                    existingCar.id,
                );
            } else {
                console.warn(
                    "[UserCarService] PaymentService não injetado; pulando vinculação automática de assinatura ao carro existente.",
                );
            }

            return existingCar;
        }

        try {
            const createdCar = await this.userCarRepository.create({
                ...restData,
                licensePlate: normalizedPlate,
                userId: resolvedUserId,
            });

            if (this.paymentService) {
                await this.paymentService.ensureSubscriptionWhenCarAdded(
                    resolvedUserId,
                    createdCar.id,
                );
            } else {
                console.warn(
                    "[UserCarService] PaymentService não injetado; pulando vinculação automática de assinatura ao carro recém-criado.",
                );
            }

            return createdCar;
        } catch (error: any) {
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error as any).code === "P2002"
            ) {
                const carAfterError =
                    await this.userCarRepository.findByLicensePlate(normalizedPlate);

                if (carAfterError) {
                    if (carAfterError.userId !== resolvedUserId) {
                        throw new AppError(
                            "Carro com esta placa já está vinculado a outro usuário",
                            400,
                        );
                    }

                    if (this.paymentService) {
                        await this.paymentService.ensureSubscriptionWhenCarAdded(
                            resolvedUserId,
                            carAfterError.id,
                        );
                    } else {
                        console.warn(
                            "[UserCarService] PaymentService não injetado; vinculação automática de assinatura foi pulada após P2002.",
                        );
                    }

                    return carAfterError;
                }

                throw new AppError("Carro com esta placa já está registrado", 400);
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

        // USER só pode editar o próprio carro
        if (user.role === "USER" && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a atualizar este carro", 403);
        }

        const updateData: UpdateUserCarDTO = { ...data };

        /**
         * REGRA:
         * - USER NÃO pode mudar placa.
         * - Mas se o frontend mandar a mesma placa no payload, a gente não quebra o update.
         */
        if (updateData.licensePlate) {
            const normalizedIncoming = this.normalizeLicensePlate(updateData.licensePlate);
            const currentNormalized = existingCar.licensePlate
                ? this.normalizeLicensePlate(existingCar.licensePlate)
                : "";

            if (user.role !== "ADMIN") {
                // Se for a mesma, ignora; se for diferente, bloqueia.
                if (normalizedIncoming !== currentNormalized) {
                    throw new AppError("Apenas administradores podem atualizar a placa", 403);
                }
                // mesma placa -> remove do update para não gerar conflito
                delete (updateData as any).licensePlate;
            } else {
                // ADMIN pode mudar placa, então normaliza e aplica
                updateData.licensePlate = normalizedIncoming;
            }
        }

        // Se seu DTO tiver userId, não permita alteração aqui (evita troca de dono por payload)
        if ("userId" in updateData) {
            delete (updateData as any).userId;
        }

        return await this.userCarRepository.update(existingCar.id, updateData);
    }

    public async deleteCar(
        carId: number,
        user: Pick<User, "id" | "role">,
    ): Promise<void> {
        const existingCar = await this.userCarRepository.findById(carId);
        if (!existingCar) {
            throw new AppError("Carro não encontrado", 404);
        }

        if (user.role === "USER" && existingCar.userId !== user.id) {
            throw new AppError("Você não está autorizado a excluir este carro", 403);
        }

        if (!existingCar.licensePlate) {
            throw new AppError(
                "Veículo não possui uma placa registrada para validação de assinatura",
                400,
            );
        }

        /**
         * REGRA:
         * - Se existe assinatura ATIVA vinculada a esse carro/placa, não pode deletar.
         * Observação: isso é o que impede o usuário de “burlar” o plano apagando o carro.
         */
        const subscriptionCar =
            await this.subscriptionRepository.findByCarLicensePlate(
                existingCar.licensePlate,
            );

        if (subscriptionCar?.isActive) {
            throw new AppError("Este veículo possui um plano ativo", 400);
        }

        await this.userCarRepository.delete(carId);
    }
}
