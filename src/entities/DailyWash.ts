export class DailyWash {
	constructor(
		public id: number,
		public carId: number,
		public washDate: Date,
		public createdAt: Date,
		public updatedAt: Date,
		public washLocationId?: number | null,
		public car?: any,
		public washLocation?: any,
	) {}
}
