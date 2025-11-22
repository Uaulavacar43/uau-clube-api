import type { Prisma } from "@prisma/client";
import prisma from "../../config/dbConfig";
import {
	type PeriodicityType,
	Plan,
	type WashService,
} from "../../entities/Plan";
import { AppError } from "../../error/AppError";
import type { IPlanRepository } from "../interfaces/IPlanRepository";

export class PrismaPlanRepository implements IPlanRepository {
	private mapWashServices(services: any[]): WashService[] {
		return services.map((service) => ({
			id: service.id,
			name: service.name,
			price: service.price,
			imageUrl: service.imageUrl,
			isAvailable: service.isAvailable,
		}));
	}

	async create(data: Plan & { washServiceIds?: number[] }): Promise<Plan> {
		const { washServiceIds, ...planData } = data;

		if (washServiceIds && washServiceIds.length > 0) {
			// Verifica se todos os serviços existem
			const existingServices = await prisma.washService.findMany({
				where: {
					id: {
						in: washServiceIds,
					},
				},
			});

			if (existingServices.length !== washServiceIds.length) {
				const foundIds = existingServices.map((service) => service.id);
				const missingIds = washServiceIds.filter(
					(id) => !foundIds.includes(id),
				);
				throw new AppError(
					`Serviços não encontrados: ${missingIds.join(", ")}`,
					400,
				);
			}
		}

		const { washServices, ...restPlanData } = planData;

		const createdPlan = await prisma.plan.create({
			data: {
				...restPlanData,
				...(washServiceIds && washServiceIds.length > 0
					? {
							washServices: {
								connect: washServiceIds.map((id) => ({ id })),
							},
						}
					: {}),
				id: undefined,
			},
			include: {
				washServices: true,
			},
		});

		return new Plan({
			...createdPlan,
			periodicityType: createdPlan.periodicityType as PeriodicityType,
			washServices: this.mapWashServices(createdPlan.washServices ?? []),
		});
	}

	async findAll(): Promise<Plan[]> {
		const plans = await prisma.plan.findMany({
			include: {
				washServices: true,
			},
		});

		return plans.map(
			(plan) =>
				new Plan({
					...plan,
					periodicityType: plan.periodicityType as PeriodicityType,
					washServices: this.mapWashServices(plan.washServices ?? []),
				}),
		);
	}

	async findById(id: number): Promise<Plan | null> {
		const plan = await prisma.plan.findUnique({
			where: { id },
			include: {
				washServices: true,
			},
		});

		if (!plan) return null;

		return new Plan({
			...plan,
			periodicityType: plan.periodicityType as PeriodicityType,
			washServices: this.mapWashServices(plan.washServices ?? []),
		});
	}

	async update(
		id: number,
		data: Partial<
			Omit<Plan, "id" | "createdAt" | "updatedAt" | "washServices">
		> & { washServiceIds?: number[] },
	): Promise<Plan> {
		const { washServiceIds, ...planData } = data;

		const updateData: Prisma.PlanUpdateInput = {
			...planData,
			...(washServiceIds !== undefined && {
				washServices: {
					set: [],
					...(washServiceIds.length > 0
						? {
								connect: washServiceIds.map((id) => ({ id })),
							}
						: {}),
				},
			}),
		};

		const updatedPlan = await prisma.plan.update({
			where: { id },
			data: updateData,
			include: {
				washServices: true,
			},
		});

		return new Plan({
			...updatedPlan,
			periodicityType: updatedPlan.periodicityType as PeriodicityType,
			washServices: this.mapWashServices(updatedPlan.washServices ?? []),
		});
	}

	async delete(id: number): Promise<void> {
		await prisma.plan.delete({ where: { id } });
	}
}
