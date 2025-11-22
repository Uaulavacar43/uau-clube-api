import type { DailyWash } from "../../entities/DailyWash";

export interface IDailyWashRepository {
	findTodayWash(userId: number, timeZoneOffset?: number): Promise<number>;
	create(carId: number, washLocationId?: number): Promise<DailyWash>;
	getUserWashHistory(
		userId: number,
		page: number,
		pageSize: number,
	): Promise<{ washes: DailyWash[]; total: number }>;
}
