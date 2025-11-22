export class Notification {
	constructor(
		public id: number,
		public title: string,
		public description: string,
		public type: "USER" | "MANAGER" | "ALL", // "USER", "MANAGER", ou "todos"
		public sentAt: Date,
		public isAutomatic: boolean,
		public totalSent: number,
		public totalFailed: number,
		public totalDelivered: number,
	) {}
}
