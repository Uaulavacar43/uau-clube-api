import type { User } from "./User";
import type { WashService } from "./WashService";

export class WashLocation {
	constructor(
		public id: number,
		public name: string,
		public managerId: number,
		public images: string[],
		public street: string,
		public number: string,
		public neighborhood: string,
		public city: string,
		public flow: "LOW" | "MODERATE" | "HIGH",
		public phoneNumber: string | null,
		public isActive: boolean,
		public services: WashService[] = [],
		public openingHours: { day: string; open: string; close: string }[] = [],
		public totalFavorites: number = 0,
		public isFavorited: boolean | undefined = undefined,
		public manager?: User,
	) {}
}
