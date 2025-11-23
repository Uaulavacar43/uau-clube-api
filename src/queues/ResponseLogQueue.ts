// src/queues/ResponseLogQueue.ts

import type { CreateResponseLogDto } from "../modules/log/dto/CreateResponseLogDto";
import { ResponseLogModel } from "../modules/log/models/ResponseLogModel";

export class ResponseLogQueue {
    private readonly responseLogModel = new ResponseLogModel();

    public async addToQueue(data: CreateResponseLogDto): Promise<void> {
        // Antes: enfileirava no Redis (BullMQ)
        // Agora: grava imediatamente no banco
        await this.responseLogModel.create(data);
    }
}
