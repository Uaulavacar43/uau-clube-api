// src/repositories/interfaces/ISubscriptionRepository.ts

import type { Subscription } from "../../entities/Subscription";

export interface ISubscriptionRepository {
	findAll(): Promise<Subscription[]>;
	findByUserId(userId: number, includeCars?: boolean): Promise<Subscription[]>;
	findByUserAndCar(userId: number, carId: number): Promise<Subscription | null>;
	findById(id: number, includeCars?: boolean): Promise<Subscription | null>;
	findByCarLicensePlate(licensePlate: string): Promise<Subscription | null>;

	// CREATE / UPDATE / CANCEL
	create(data: Subscription): Promise<Subscription>;
	update(
		subscriptionId: number,
		data: Partial<Omit<Subscription, "car" | "id" | "plan">>,
	): Promise<Subscription>;
	cancel(subscriptionId: number): Promise<void>;
	delete(subscriptionId: number): Promise<void>;

	getByAsaasId(subscriptionIdAsaas: string): Promise<Subscription | null>;
	getByInstallmentIdAsaas(
		installmentIdAsaas: string,
	): Promise<Subscription | null>;
	cancelByAsaasId(subscriptionIdAsaas: string): Promise<void>;

	/**
	 * NUEVO MÉTODO:
	 * Devuelve la suscripción activa de un usuario (isActive = true), si existe.
	 */
	getActiveSubscriptionByUserId(userId: number): Promise<Subscription | null>;
}
