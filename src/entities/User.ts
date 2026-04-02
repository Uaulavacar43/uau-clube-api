import type { Subscription } from "./Subscription";

export class User {
	public id: number;
	public name: string;
	public email: string;
	public password: string;
	public phone: string | null;
	public cpf: string | null;
	public role: "ADMIN" | "USER" | "MANAGER";
	public profileImageUrl: string | null = null;
	public firebaseTokens: string[] = [];
	public otp: string | null = null;
	public status: "ACTIVE" | "INACTIVE";
	public subscriptions: Subscription[] = [];
	public createdAt = new Date();
	public updatedAt = new Date();
	public cars: any[] = [];
	public washLocations: any[] = [];
	public washServices: any[] = [];
	public payments: any[] = [];
	public notifications: any[] = [];
	public asaasCustomerId: string | null = null;
	public deletedAt: Date | null = null;
	public welcomeBonusUsed = false;

	constructor(
		data: Partial<User> & {
			id: number;
			name: string;
			email: string;
			password: string;
			role: "ADMIN" | "USER" | "MANAGER";
		},
	) {
		this.id = data.id;
		this.name = data.name;
		this.email = data.email;
		this.password = data.password;
		this.phone = data.phone ?? null;
		this.cpf = data.cpf ?? null;
		this.role = data.role;
		this.profileImageUrl = data.profileImageUrl ?? null;
		this.firebaseTokens = data.firebaseTokens ?? [];
		this.otp = data.otp ?? null;
		this.status = data.status ?? "ACTIVE";
		this.subscriptions = data.subscriptions ?? [];
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
		this.cars = data.cars ?? [];
		this.washLocations = data.washLocations ?? [];
		this.washServices = data.washServices ?? [];
		this.payments = data.payments ?? [];
		this.notifications = data.notifications ?? [];
		this.asaasCustomerId = data.asaasCustomerId ?? null;
		this.deletedAt = data.deletedAt ?? null;
		this.welcomeBonusUsed = data.welcomeBonusUsed ?? false;
	}
}
