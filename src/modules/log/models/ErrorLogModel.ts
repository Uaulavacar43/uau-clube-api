import prisma from "../../../config/dbConfig";
import type { CreateErrorLogDto } from "../dto/CreateErrorLogDto";

export class ErrorModel {
	async create(error: CreateErrorLogDto) {
		return await prisma.errorLog.create({
			data: error,
		});
	}
}
