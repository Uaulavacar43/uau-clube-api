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
		return (services ?? []).map((service) => ({
			id: service.id,
			name: service.name,
			price: service.price,
			imageUrl: service.imageUrl,
			isAvailable: service.isAvailable,
		}));
	}

	private async assertWashServicesExist(washServiceIds: number[]): Promise<void> {
		if (!washServiceIds || washServiceIds.length === 0) return;

		const existingServices = await prisma.washService.findMany({
			where: {
				id: {
					in: washServiceIds,
				},
			},
			select: { id: true },
		});

		if (existingServices.length !== washServiceIds.length) {
			const foundIds = existingServices.map((service) => service.id);
			const missingIds = washServiceIds.filter((id) => !foundIds.includes(id));

			throw new AppError(
				`Serviços não encontrados: ${missingIds.join(", ")}`,
				400,
			);
		}
	}

	async create(data: Plan & { washServiceIds?: number[] }): Promise<Plan> {
		const { washServiceIds, ...planData } = data;

		if (washServiceIds && washServiceIds.length > 0) {
			await this.assertWashServicesExist(washServiceIds);
		}

		/**
		 * CRÍTICO:
		 * Nunca repassar `id` (ex.: id: 0), nem createdAt/updatedAt, nem washServices
		 * para o Prisma no create. O Prisma deve autogerar o ID.
		 */
		const {
			id: _id,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			washServices: _washServices,
			...restPlanData
		} = planData as any;

		try {
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
		} catch (error: any) {
			/**
			 * Se alguém ainda tentar forçar ID, isso geralmente vira P2002 em id.
			 * Transformamos em mensagem clara.
			 */
			if (error?.code === "P2002") {
				const target = error?.meta?.target;
				if (Array.isArray(target) && target.includes("id")) {
					throw new AppError(
						"Erro ao criar plano: o campo 'id' não pode ser enviado no create (autoincrement). Garanta que nenhum 'id' esteja sendo passado (ex.: id: 0).",
						500,
					);
				}

				throw new AppError(
					`Erro de unicidade ao criar plano (P2002). Meta=${JSON.stringify(
						error?.meta ?? {},
					)}`,
					500,
				);
			}

			throw error;
		}
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

		if (washServiceIds && washServiceIds.length > 0) {
			await this.assertWashServicesExist(washServiceIds);
		}

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
