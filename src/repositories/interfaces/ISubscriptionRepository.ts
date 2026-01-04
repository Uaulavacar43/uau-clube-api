// src/repositories/interfaces/ISubscriptionRepository.ts
import type { Subscription } from "../../entities/Subscription";

export interface ISubscriptionRepository {
	findByUserAndCar(userId: number, carId: number): Promise<Subscription | null>;
	findById(id: number, includeCars?: boolean): Promise<Subscription | null>;
	findByUserId(userId: number, includeCars?: boolean): Promise<Subscription[]>;

	/**
	 * ✅ REGRA NOVA: placa é única por usuário
	 */
	findByCarLicensePlateAndUserId(
		licensePlate: string,
		userId: number,
	): Promise<Subscription | null>;

	// CREATE / UPDATE / CANCEL
	create(data: Subscription): Promise<Subscription>;
	update(
		subscriptionId: number,
		data: Partial<Omit<Subscription, "id">> | Subscription,
	): Promise<Subscription>;

	cancel(subscriptionId: number): Promise<void>;

	getByAsaasId(subscriptionIdAsaas: string): Promise<Subscription | null>;
	getByInstallmentIdAsaas(installmentIdAsaas: string): Promise<Subscription | null>;
	cancelByAsaasId(subscriptionIdAsaas: string): Promise<void>;

	getActiveSubscriptionByUserId(userId: number): Promise<Subscription | null>;
}
