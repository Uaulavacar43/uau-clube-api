import prisma from "../../config/dbConfig";
import { IndividualServicePurchase } from "../../entities/IndividualServicePurchase";
import type { IIndividualServicePurchaseRepository } from "../interfaces/IIndividualServicePurchaseRepository";

export class PrismaIndividualServicePurchaseRepository
	implements IIndividualServicePurchaseRepository
{
	public async create(
		data: IndividualServicePurchase,
	): Promise<IndividualServicePurchase> {
		const created = await prisma.individualServicePurchase.create({
			data: {
				...data,
				id: data.id ?? undefined,
				user: undefined,
				washService: undefined,
				payment: undefined,
			},
		});

		return new IndividualServicePurchase(
			created.id,
			created.userId,
			created.washServiceId,
			created.purchaseDate || new Date(),
			created.status,
			created.createdAt,
			created.updatedAt,
			created.paymentId ?? undefined,
		);
	}

	public async findById(id: number): Promise<IndividualServicePurchase | null> {
		const result = await prisma.individualServicePurchase.findUnique({
			where: { id },
		});
		if (!result) return null;

		return new IndividualServicePurchase(
			result.id,
			result.userId,
			result.washServiceId,
			result.purchaseDate || new Date(),
			result.status,
			result.createdAt,
			result.updatedAt,
			result.paymentId ?? undefined,
		);
	}

	public async findByUserAndService(
		userId: number,
		washServiceId: number,
	): Promise<IndividualServicePurchase | null> {
		const result = await prisma.individualServicePurchase.findFirst({
			where: { userId, washServiceId },
			orderBy: { createdAt: "desc" },
		});

		if (!result) return null;

		return new IndividualServicePurchase(
			result.id,
			result.userId,
			result.washServiceId,
			result.purchaseDate || new Date(),
			result.status,
			result.createdAt,
			result.updatedAt,
			result.paymentId ?? undefined,
		);
	}

	public async updateStatus(
		id: number,
		status: "PENDING" | "COMPLETED" | "CANCELED",
	): Promise<IndividualServicePurchase | null> {
		const updated = await prisma.individualServicePurchase.update({
			where: { id },
			data: { status },
		});

		if (!updated) return null;

		return new IndividualServicePurchase(
			updated.id,
			updated.userId,
			updated.washServiceId,
			updated.purchaseDate || new Date(),
			updated.status,
			updated.createdAt,
			updated.updatedAt,
			updated.paymentId ?? undefined,
		);
	}

	public async linkPayment(
		id: number,
		paymentId: number,
	): Promise<IndividualServicePurchase | null> {
		const updated = await prisma.individualServicePurchase.update({
			where: { id },
			data: { paymentId },
		});

		if (!updated) return null;

		return new IndividualServicePurchase(
			updated.id,
			updated.userId,
			updated.washServiceId,
			updated.purchaseDate || new Date(),
			updated.status,
			updated.createdAt,
			updated.updatedAt,
			updated.paymentId ?? undefined,
		);
	}
}
