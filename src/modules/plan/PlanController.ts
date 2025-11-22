import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../error/AppError";
import { type CreatePlanDTO, CreatePlanSchema } from "./dto/CreatePlanDTO";
import { type UpdatePlanDTO, UpdatePlanSchema } from "./dto/UpdatePlanDTO";
import type { PlanService } from "./PlanService";

export class PlanController {
	constructor(private planService: PlanService) {}

	async create(
		_req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const data = res.locals as CreatePlanDTO;

		try {
			const plan = await this.planService.create(data);
			res.status(201).customJson(this.formatPlanResponse(plan));
		} catch (error) {
			next(error);
		}
	}

	async findAll(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const plans = await this.planService.findAll();
			res
				.status(200)
				.customJson(plans.map((plan) => this.formatPlanResponse(plan)));
		} catch (error) {
			next(error);
		}
	}

	async findById(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		try {
			const id = Number(req.params.id);
			if (isNaN(id)) {
				throw new AppError("ID inválido", 400);
			}
			const plan = await this.planService.findById(id);
			res.status(200).customJson(this.formatPlanResponse(plan));
		} catch (error) {
			next(error);
		}
	}

	async update(req: Request, res: Response, next: NextFunction): Promise<void> {
		const id = Number(req.params.id);
		const data = res.locals as UpdatePlanDTO;

		try {
			if (isNaN(id)) {
				throw new AppError("ID inválido", 400);
			}
			const plan = await this.planService.update(id, data);
			res.status(200).customJson(this.formatPlanResponse(plan));
		} catch (error) {
			next(error);
		}
	}

	async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
		try {
			const id = Number(req.params.id);
			if (isNaN(id)) {
				throw new AppError("ID inválido", 400);
			}
			await this.planService.delete(id);
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	}

	private formatPlanResponse(plan: any) {
		return {
			id: plan.id,
			name: plan.name,
			description: plan.description,
			price: plan.price,
			duration: plan.duration,
			isBestChoice: plan.isBestChoice,
			extraMonths: plan.extraMonths,
			isPackage: plan.isPackage,
			periodicityType: plan.periodicityType,
			createdAt: plan.createdAt,
			updatedAt: plan.updatedAt,
			washServices: plan.washServices || [],
		};
	}
}
