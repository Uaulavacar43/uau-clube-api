// src/queues/RequestLogQueue.ts

import type { CreateRequestLogDto } from "../modules/log/dto/CreateRequestLogDto";
import { RequestLogModel } from "../modules/log/models/RequestLogModel";

export class RequestLogQueue {
    private readonly requestLogModel = new RequestLogModel();

    public async addToQueue(data: CreateRequestLogDto): Promise<void> {
        // Antes: enfileirava no Redis (BullMQ)
        // Agora: grava imediatamente no banco
        await this.requestLogModel.create(data);
    }
}
