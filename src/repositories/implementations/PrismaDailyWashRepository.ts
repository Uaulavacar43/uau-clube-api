import prisma from "../../config/dbConfig";
import { DailyWash } from "../../entities/DailyWash";
import type { IDailyWashRepository } from "../interfaces/IDailyWashRepository";

export class PrismaDailyWashRepository implements IDailyWashRepository {
	public async create(
		carId: number,
		washLocationId?: number,
	): Promise<DailyWash> {
		const createdWash = await prisma.dailyWash.create({
			data: {
				carId: carId,
				washDate: new Date(),
				washLocationId: washLocationId,
			},
		});

		return new DailyWash(
			createdWash.id,
			createdWash.carId,
			createdWash.washDate,
			createdWash.createdAt,
			createdWash.updatedAt,
			createdWash.washLocationId,
		);
	}

	// Caso já tenha sido utilizada a lavagem diária do dia atual ela é retornada, caso contrário null
	public async findTodayWash(
		userId: number,
		timeZoneOffset?: number,
	): Promise<number> {
		const userSubscriptions = await prisma.subscription.findMany({
			where: {
				userId: userId,
				isActive: true,
			},
		});
		const userCarIds = userSubscriptions
			.map((s) => s.carId)
			.filter(Boolean) as number[];

		const offset = timeZoneOffset ?? new Date().getTimezoneOffset();
		const startDate = new Date();
		startDate.setHours(0, 0, 0);
		startDate.setMinutes(startDate.getMinutes() - offset);
		const endDate = new Date();
		endDate.setHours(23, 59, 59, 999);
		endDate.setMinutes(endDate.getMinutes() - offset);

		console.log({
			timeZoneOffset,
			startDate,
			endDate,
		});

		const todayWash = await prisma.dailyWash.findMany({
			where: {
				carId: {
					in: userCarIds,
				},
				washDate: {
					gte: startDate,
					lt: endDate,
				},
			},
		});

		const totalAvailableWashes =
			userCarIds.length - todayWash.length < 0
				? 0
				: userCarIds.length - todayWash.length;

		return totalAvailableWashes;
	}

	public async getUserWashHistory(
		userId: number,
		page: number,
		pageSize: number,
	): Promise<{ washes: DailyWash[]; total: number }> {
		const skip = (page - 1) * pageSize;
		const take = pageSize;

		// Get all cars belonging to the user
		const userCars = await prisma.car.findMany({
			where: {
				userId: userId,
				deletedAt: null,
			},
			select: {
				id: true,
			},
		});

		const userCarIds = userCars.map((car) => car.id);

		// Get wash history for all user cars with pagination
		const washHistory = await prisma.dailyWash.findMany({
			where: {
				carId: {
					in: userCarIds,
				},
			},
			include: {
				car: true,
				washLocation: true,
			},
			orderBy: {
				washDate: "desc",
			},
			skip,
			take,
		});

		// Get total count for pagination
		const total = await prisma.dailyWash.count({
			where: {
				carId: {
					in: userCarIds,
				},
			},
		});

		// Map to entity objects
		const washes = washHistory.map(
			(wash) =>
				new DailyWash(
					wash.id,
					wash.carId,
					wash.washDate,
					wash.createdAt,
					wash.updatedAt,
					wash.washLocationId || undefined,
					wash.car,
					wash.washLocation || undefined,
				),
		);

		return { washes, total };
	}
}
