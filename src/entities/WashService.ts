import type { IndividualServicePurchase } from "./IndividualServicePurchase";
import type { WashLocation } from "./WashLocation";

export class WashService {
	constructor(
		public id: number,
		public name: string,
		public price: number,
		public imageUrl: string,
		public isAvailable: boolean,
		public isPublished: boolean,
		public adminId: number,
		public locations: WashLocation[] = [],
		public individualServicePurchases?: IndividualServicePurchase[],
	) {}
}
