import prisma from "../../../config/dbConfig";
import type { CreateRequestLogDto } from "../dto/CreateRequestLogDto";

export class RequestLogModel {
	async create(data: CreateRequestLogDto) {
		const requestLog = await prisma.requestLog.create({
			data,
		});

		return requestLog;
	}
}
