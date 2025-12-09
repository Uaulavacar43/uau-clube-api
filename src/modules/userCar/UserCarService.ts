// src/modules/userCar/UserCarService.ts

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
        // Torna opcional para não quebrar pontos que ainda instanciam com 2 argumentos
        private paymentService?: PaymentService,
    ) {}

    /**
     * Normaliza a placa do veículo:
     * - remove caracteres não alfanuméricos (traços, espaços, etc.)
     * - converte para maiúsculas
     *
     * Complementa o transform do Zod (que já faz toUpperCase),
     * garantindo que "ABC-1234" e "abc 1234" virem "ABC1234".
     */
    private normalizeLicensePlate(licensePlate: string): string {
        if (!licensePlate) {
            return licensePlate;
        }

        return licensePlate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    }

    /**
     * Registra um novo carro para o usuário.
     *
     * Regras:
     * - Usa `data.userId` se vier preenchido (admin), senão usa o `userId` do contexto (usuário autenticado).
     * - Placa é normalizada (sem traços/espaços, maiúscula).
     * - Se já existir um carro com essa placa para o MESMO usuário:
     *     → reutiliza o carro existente e garante a vinculação de assinatura.
     * - Se já existir um carro com essa placa para OUTRO usuário:
     *     → retorna erro informando que a placa já está vinculada a outro usuário.
     * - Não envia `id` para o repositório no create, para não conflitar com o
     *     `@default(autoincrement())` do Prisma (evita P2002 em `Car.id`).
     * - Trata erro de constraint única (P2002) de forma amigável.
     */
    public async registerCar(
        data: RegisterUserCarDTO,
        userId: number,
    ): Promise<UserCar> {
        // Se o DTO trouxer userId (caso admin), ele tem prioridade
        const resolvedUserId = data.userId ?? userId;

        const normalizedPlate = this.normalizeLicensePlate(data.licensePlate);

        // Descarta qualquer `id` que eventualmente chegue acoplado
        const { userId: _dtoUserId, licensePlate, ...restData } = data as RegisterUserCarDTO & {
            id?: number;
        };

        // Primeiro, tenta localizar carro pela placa normalizada
        const existingCar = await this.userCarRepository.findByLicensePlate(
            normalizedPlate,
        );

        if (existingCar) {
            // Se o carro já pertence a outro usuário, não podemos reutilizar silenciosamente
            if (existingCar.userId !== resolvedUserId) {
                throw new AppError(
                    "Carro com esta placa já está vinculado a outro usuário",
                    400,
                );
            }

            // Carro já pertence a este usuário:
            // apenas garante a vinculação automática de assinatura, se aplicável
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

            // Regra de negócio:
            // Assim que o usuário adicionar um carro, verificamos se ele possui
            // pagamentos em dia / plano ativo (incluindo importados do ASAAS)
            // e vinculamos automaticamente a assinatura ao veículo, quando aplicável.
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
            // Tratamento específico para erro de constraint única (P2002),
            // que no log apareceu como:
            // "PrismaClientKnownRequestError: Unique constraint failed on the fields: (`id`) meta: { modelName: 'Car', target: ['id'] }"
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error as any).code === "P2002"
            ) {
                // Em caso de corrida (race condition) ou estado inconsistente,
                // tentamos localizar novamente o carro pela placa normalizada.
                const carAfterError =
                    await this.userCarRepository.findByLicensePlate(normalizedPlate);

                if (carAfterError) {
                    if (carAfterError.userId !== resolvedUserId) {
                        throw new AppError(
                            "Carro com esta placa já está vinculado a outro usuário",
                            400,
                        );
                    }

                    // Se agora pertence ao mesmo usuário, garantimos assinatura e retornamos
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

                // Se mesmo assim não encontramos, retornamos um erro genérico de duplicidade
                throw new AppError(
                    "Carro com esta placa já está registrado",
                    400,
                );
            }

            // Se não for P2002, propagamos o erro original
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

        if (user.role === "USER" && existingCar.userId !== user.id) {
            throw new AppError(
                "Você não está autorizado a atualizar este carro",
                403,
            );
        }

        // Normaliza a placa se o update trouxer uma nova placa
        const updateData: UpdateUserCarDTO = { ...data };

        if (updateData.licensePlate) {
            updateData.licensePlate = this.normalizeLicensePlate(
                updateData.licensePlate,
            );
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
            throw new AppError(
                "Você não está autorizado a excluir este carro",
                403,
            );
        }

        // Aqui fazemos o narrowing de tipo para garantir que a placa é string,
        // evitando o TS2345 quando o tipo é `string | null`.
        if (!existingCar.licensePlate) {
            throw new AppError(
                "Veículo não possui uma placa registrada para validação de assinatura",
                400,
            );
        }

        const subscriptionCar =
            await this.subscriptionRepository.findByCarLicensePlate(
                existingCar.licensePlate, // aqui o tipo já é só `string`
            );

        if (subscriptionCar?.isActive) {
            throw new AppError("Este veículo possui um plano ativo", 400);
        }

        await this.userCarRepository.delete(carId);
    }
}
