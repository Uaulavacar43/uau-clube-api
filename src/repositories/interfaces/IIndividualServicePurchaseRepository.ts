import type { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";

export interface IIndividualServicePurchaseRepository {
	create(data: IndividualServicePurchase): Promise<IndividualServicePurchase>;
	findById(id: number): Promise<IndividualServicePurchase | null>;
	findByUserAndService(
		userId: number,
		washServiceId: number,
	): Promise<IndividualServicePurchase | null>;
	updateStatus(
		id: number,
		status: "PENDING" | "COMPLETED" | "CANCELED",
	): Promise<IndividualServicePurchase | null>;
	linkPayment(
		id: number,
		paymentId: number,
	): Promise<IndividualServicePurchase | null>;
}
