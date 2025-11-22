import prisma from "../../config/dbConfig";
import WebhookError from "../../entities/WebhookError";
import type IWebhookErrorsRepository from "../interfaces/IWebhookErrorsRepository";

export class PrismaWebhookErrorRepository implements IWebhookErrorsRepository {
	/**
	 * Guarda un error de webhook en la base de datos
	 */
	async create(webhookError: WebhookError): Promise<WebhookError> {
		try {
			const createdError = await prisma.webhookErrors.create({
				data: {
					statusCode: webhookError.statusCode ?? null, // Asegurar compatibilidad con DB
					subscription_id: webhookError.subscription_id ?? null,
					payment_id: webhookError.payment_id ?? null,
					user_id: webhookError.user_id ?? null,
					//payload: webhookError.payload ? JSON.stringify(webhookError.payload) : null,
					//response: webhookError.response ? JSON.stringify(webhookError.response) : null,
				},
			});

			return this.mapToEntity(createdError);
		} catch (error) {
			console.error(
				"[PrismaWebhookErrorRepository] Error al guardar webhook error:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Obtiene todos los errores de webhooks ordenados por fecha de creación (descendente)
	 */
	async getAll(): Promise<WebhookError[]> {
		try {
			const errors = await prisma.webhookErrors.findMany({
				orderBy: { createdAt: "desc" },
			});

			return errors.map(this.mapToEntity);
		} catch (error) {
			console.error(
				"[PrismaWebhookErrorRepository] Error al obtener webhook errors:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Mapea un registro de Prisma a la entidad WebhookError
	 */
	private mapToEntity(webhookErrorData: any): WebhookError {
		return new WebhookError({
			id: webhookErrorData.id,
			statusCode: webhookErrorData.statusCode ?? null,
			subscription_id: webhookErrorData.subscription_id ?? null,
			payment_id: webhookErrorData.payment_id ?? null,
			user_id: webhookErrorData.user_id ?? null,
			payload: webhookErrorData.payload
				? JSON.parse(webhookErrorData.payload.toString())
				: null,
			response: webhookErrorData.response
				? JSON.parse(webhookErrorData.response.toString())
				: null,
			createdAt: webhookErrorData.createdAt,
		});
	}
}
