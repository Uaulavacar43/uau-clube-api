import { type Plan, WashService } from "../../entities/Plan";

export interface IPlanRepository {
	create(data: Plan & { washServiceIds?: number[] }): Promise<Plan>;

	findAll(): Promise<Plan[]>;
	findById(id: number): Promise<Plan | null>;
	update(
		id: number,
		data: Partial<
			Omit<Plan, "id" | "createdAt" | "updatedAt" | "washServices">
		> & { washServiceIds?: number[] },
	): Promise<Plan>;
	delete(id: number): Promise<void>;
}
