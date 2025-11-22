import prisma from "../../../config/dbConfig";
import type { CreateResponseLogDto } from "../dto/CreateResponseLogDto";

export class ResponseLogModel {
	async create(data: CreateResponseLogDto) {
		const requestId: string | undefined = data.requestId;
		let requestLogId: number | undefined;

		if (requestId) {
			const requestLog = await prisma.requestLog.findUnique({
				where: { requestId },
			});

			if (!requestLog) {
				requestLogId = undefined;
			} else {
				requestLogId = requestLog.id;
			}
		}

		const responseLog = await prisma.responseLog.create({
			data: {
				...data,
				requestId: requestLogId,
			},
		});

		return responseLog;
	}
}
