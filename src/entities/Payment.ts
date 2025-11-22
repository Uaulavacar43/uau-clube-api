export class Payment {
	constructor(data: {
		id?: number;
		userId: number;
		planId?: number | null;
		amount: number;
		paymentDate?: Date;
		status: "PAID" | "PENDING" | "CANCELED";
		installments?: number | null;
		pixQrCode?: string | null;
		pixPayload?: string | null;
		createdAt?: Date;
		updatedAt?: Date;
		paymentMethodId?: string | null;
		paymentIdAsaas?: string | null; // ID remoto en ASAAS
		couponId?: number | null;
	}) {
		this.id = data.id ?? 0;
		this.userId = data.userId;
		this.planId = data.planId;
		this.amount = data.amount;
		this.paymentDate = data.paymentDate ?? new Date();
		this.status = data.status;
		this.installments = data.installments ?? null;
		this.pixQrCode = data.pixQrCode;
		this.pixPayload = data.pixPayload;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
		this.paymentMethodId = data.paymentMethodId;
		this.paymentIdAsaas = data.paymentIdAsaas;
		this.couponId = data.couponId;
	}

	id: number;
	userId: number;
	planId?: number | null;
	amount: number;
	paymentDate: Date;
	status: "PAID" | "PENDING" | "CANCELED";
	installments?: number | null;
	pixQrCode?: string | null;
	pixPayload?: string | null;
	createdAt: Date;
	updatedAt: Date;
	paymentMethodId?: string | null;
	paymentIdAsaas?: string | null;
	couponId?: number | null;
}
