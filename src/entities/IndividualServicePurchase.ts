import type { Payment } from "./Payment";
import type { User } from "./User";
import type { WashService } from "./WashService";

export class IndividualServicePurchase {
	constructor(
		public id: number | null = null,
		public userId: number,
		public washServiceId: number,
		public purchaseDate: Date,
		public status: "PENDING" | "COMPLETED" | "CANCELED",
		public createdAt: Date,
		public updatedAt: Date,
		public paymentId: number,
		public washService?: WashService,
		public payment?: Payment,
		public user?: User,
	) {}
}
