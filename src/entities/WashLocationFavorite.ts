export class WashLocationFavorite {
	constructor(
		public id: number,
		public userId: number,
		public washLocationId: number,
		public createdAt: Date,
		public updatedAt: Date,
	) {}
}
