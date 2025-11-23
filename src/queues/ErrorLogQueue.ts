// src/queues/ErrorLogQueue.ts

import type { CreateErrorLogDto } from "../modules/log/dto/CreateErrorLogDto";
import { ErrorModel } from "../modules/log/models/ErrorLogModel";

export class ErrorLogQueue {
    private readonly errorModel = new ErrorModel();

    public async addToQueue(error: CreateErrorLogDto): Promise<void> {
        // Antes: enfileirava no Redis (BullMQ)
        // Agora: grava imediatamente no banco
        const { requestId, message, stack, data } = error;
        await this.errorModel.create({ requestId, message, stack, data });
    }
}
