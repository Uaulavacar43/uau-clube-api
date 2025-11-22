import type { Payment } from "../../entities/Payment";
import type { GetAllPaymentsWithDetailsDTO } from "../../modules/payment/dto/GetAllPaymentsWithDetailsDTO";

export interface PaymentFilter {
	id?: number;
	userId?: number;
	planId?: number;
	paymentIdAsaas?: string;
	payment_id?: string;
}

export interface PaymentDetail {
	status: "PAID" | "PENDING" | "CANCELED";
	id: number;
	amount: number;
	paymentDate: Date;
	installments: number | null;
	pixQrCode: string | null;
	pixPayload: string | null;
	createdAt: Date;
	updatedAt: Date;
	user: {
		cpf: string | null;
		name: string;
	};
	plan: {
		name: string;
		price: number;
	} | null;
	individualServicePurchases:
		| {
				status: "PENDING" | "CANCELED" | "COMPLETED";
				id: number;
				createdAt: Date;
				updatedAt: Date;
				washService:
					| {
							id: number;
							name: string;
							price: number;
					  }
					| undefined;
		  }[]
		| undefined;
	coupon:
		| {
				code: string;
				discountType: "PERCENTAGE" | "FIXED";
				discountValue: number;
		  }
		| null
		| undefined;
}

export interface IPaymentRepository {
	create(data: Payment): Promise<Payment>;
	getAll(filter: PaymentFilter): Promise<Payment[]>;
	getOneByFilter(filter: PaymentFilter): Promise<Payment | null>;
	update(
		filter: PaymentFilter,
		data: Partial<Payment>,
		updateIndividualStatus: boolean,
	): Promise<Payment | null>;
	getByAsaasId(paymentIdAsaas: string): Promise<Payment | null>;
	updatePaymentStatus(
		paymentId: number,
		status: "PAID" | "PENDING" | "CANCELED",
	): Promise<void>;

	getMonthlyRevenueHistory(): Promise<{ month: string; total: number }[]>;
	getYearlyRevenueHistory(): Promise<{ year: number; total: number }[]>;
	getTotalRevenue(): Promise<number>;
	getCurrentMonthRevenue(): Promise<number>;
	getNextMonthPredictedRevenue(): Promise<number>;
	getAllPaymentsWithDetails(data: GetAllPaymentsWithDetailsDTO): Promise<any>;
	getPaymentDetailsById(paymentId: number): Promise<PaymentDetail | null>;
	getMRR(): Promise<number>;
}
