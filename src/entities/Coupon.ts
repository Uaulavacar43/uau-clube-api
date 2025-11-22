import type { Plan } from "./Plan";
import type { WashService } from "./WashService";

export class Coupon {
	constructor(
		public readonly id: number,
		public readonly code: string,
		public readonly description: string,
		public readonly discountType: "PERCENTAGE" | "FIXED",
		public readonly discountValue: number,
		public readonly validFrom: Date,
		public readonly validUntil: Date,
		public readonly isActive: boolean,
		public readonly currentUsage: number,
		public readonly createdAt: Date,
		public readonly updatedAt: Date,
		public readonly additionalInfo?: string | null,
		public readonly maxDiscountValue?: number | null,
		public readonly usageLimit?: number | null,
		public readonly plans?: Plan[],
		public readonly services?: WashService[],
	) {}
}
