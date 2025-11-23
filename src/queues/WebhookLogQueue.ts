// src/queues/WebhookLogQueue.ts

import type { CreateWebhookLogDto } from "../modules/log/dto/CreateWebhookLogDto";
import { WebhookLogModel } from "../modules/log/models/WebhookLogModel";

export class WebhookLogQueue {
    private readonly webhookLogModel = new WebhookLogModel();

    public async addToQueue(data: CreateWebhookLogDto): Promise<void> {
        // Antes: enfileirava no Redis (BullMQ)
        // Agora: grava imediatamente no banco
        await this.webhookLogModel.create(data);
    }
}
