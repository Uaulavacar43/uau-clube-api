import prisma from "../../../config/dbConfig";
import type { CreateWebhookLogDto } from "../dto/CreateWebhookLogDto";

export class WebhookLogModel {
	async create(data: CreateWebhookLogDto) {
		const webhookLog = await prisma.webhookLog.create({
			data,
		});

		return webhookLog;
	}
}
