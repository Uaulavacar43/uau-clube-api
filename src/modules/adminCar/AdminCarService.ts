import type { UserCar } from "../../entities/UserCar";
import { AppError } from "../../error/AppError";
import type { ISubscriptionRepository } from "../../repositories/interfaces/ISubscriptionRepository";
import type { IUserCarRepository } from "../../repositories/interfaces/IUserCarRepository";
import type { AdminUpdateCarDTO } from "./dto/AdminUpdateCarDTO";
import { PaymentService } from "../payment/PaymentService";

export class AdminCarService {
    constructor(
        private userCarRepository: IUserCarRepository,
        private subscriptionRepository: ISubscriptionRepository,
        private paymentService?: PaymentService,
    ) {}

    private normalizeLicensePlate(licensePlate: string): string {
        return (licensePlate ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    public async getCarByPlate(licensePlate: string, includeInactive = true): Promise<UserCar> {
        const plate = this.normalizeLicensePlate(licensePlate);
        const car = await this.userCarRepository.findByLicensePlate(plate, includeInactive);

        if (!car) throw new AppError("Carro não encontrado para essa placa", 404);
        return car;
    }

    public async updateCar(data: AdminUpdateCarDTO): Promise<UserCar> {
        const car = await this.userCarRepository.findById(data.id, true);
        if (!car) throw new AppError("Carro não encontrado", 404);

        // 1) Se for mudar placa, validar colisão (inclusive com desativados, pois trava a UNIQUE)
        let normalizedIncomingPlate: string | undefined = undefined;
        if (data.licensePlate) {
            normalizedIncomingPlate = this.normalizeLicensePlate(data.licensePlate);

            const existing = await this.userCarRepository.findByLicensePlate(normalizedIncomingPlate, true);
            if (existing && existing.id !== car.id) {
                throw new AppError(
                    "Já existe um carro cadastrado com essa placa. Se ele estiver desativado, reative-o no painel.",
                    409,
                );
            }
        }

        // 2) Ativar/desativar (regra: não desativar se existir plano ativo)
        let deletedAt: Date | null | undefined = undefined;
        if (data.isActive !== undefined) {
            if (data.isActive === true) {
                deletedAt = null;
            } else {
                const subByUserAndCar = await this.subscriptionRepository.findByUserAndCar(car.userId, car.id);
                if (subByUserAndCar?.isActive) {
                    throw new AppError("Este veículo possui um plano ativo. Não é possível desativar.", 400);
                }

                if (car.licensePlate) {
                    const subByPlate = await this.subscriptionRepository.findByCarLicensePlate(car.licensePlate);
                    if (subByPlate?.isActive) {
                        throw new AppError("Este veículo possui um plano ativo. Não é possível desativar.", 400);
                    }
                }

                deletedAt = new Date();
            }
        }

        // 3) (Opcional) transferir para outro usuário
        const updatePayload: any = {};
        if (normalizedIncomingPlate) updatePayload.licensePlate = normalizedIncomingPlate;
        if (deletedAt !== undefined) updatePayload.deletedAt = deletedAt;
        if (data.userId) updatePayload.userId = data.userId;

        const updated = await this.userCarRepository.update(car.id, updatePayload);

        // 4) Segurança extra: se ativou ou corrigiu, tenta garantir vínculo de assinatura
        if (this.paymentService && (data.isActive === true || !!normalizedIncomingPlate)) {
            try {
                await this.paymentService.ensureSubscriptionWhenCarAdded(updated.userId, updated.id);
            } catch {
                // best effort, não quebra o admin
            }
        }

        return updated;
    }
}
