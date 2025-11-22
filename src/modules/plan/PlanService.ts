import { Plan, WashService } from "../../entities/Plan";
import { AppError } from "../../error/AppError";
import type { IPlanRepository } from "../../repositories/interfaces/IPlanRepository";
import type { CreatePlanDTO } from "./dto/CreatePlanDTO";
import type { UpdatePlanDTO } from "./dto/UpdatePlanDTO";

export class PlanService {
	constructor(private planRepository: IPlanRepository) {}

	async create(data: CreatePlanDTO): Promise<Plan> {
		const plan = new Plan(data);

		return await this.planRepository.create({
			...plan,
			washServiceIds: data.washServiceIds,
		});
	}

	async findAll(): Promise<Plan[]> {
		return await this.planRepository.findAll();
	}

	async findById(id: number): Promise<Plan> {
		const plan = await this.planRepository.findById(id);
		if (!plan) {
			throw new AppError("Plano não encontrado", 404);
		}
		return plan;
	}

	async update(id: number, data: UpdatePlanDTO): Promise<Plan> {
		const plan = await this.planRepository.findById(id);
		if (!plan) {
			throw new AppError("Plano não encontrado", 404);
		}

		return await this.planRepository.update(id, data);
	}

	async delete(id: number): Promise<void> {
		const plan = await this.planRepository.findById(id);
		if (!plan) {
			throw new AppError("Plano não encontrado", 404);
		}
		await this.planRepository.delete(id);
	}
}
