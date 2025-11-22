import { Worker as BullWorker, type ConnectionOptions, Queue } from "bullmq";
import { QUEUES } from "../config/queues";
import redisConfig from "../config/redis";
import type { CreateErrorLogDto } from "../modules/log/dto/CreateErrorLogDto";
import { ErrorModel } from "../modules/log/models/ErrorLogModel";

const connection: ConnectionOptions = {
	host: redisConfig.host,
	port: redisConfig.port,
};

export class ErrorLogQueue {
	public queue = new Queue(QUEUES.ERROR, { connection });

	private errorModel = new ErrorModel();

	public worker = new BullWorker(
		QUEUES.ERROR,
		async (job) => {
			const { requestId, message, stack, data } = job.data as CreateErrorLogDto;
			job.updateProgress(10);
			await this.errorModel.create({ requestId, message, stack, data });
			job.updateProgress(100);
		},
		{ connection },
	);

	public addToQueue(error: CreateErrorLogDto) {
		this.queue.add(QUEUES.ERROR, error, {
			attempts: 3,
			removeOnComplete: {
				age: 1000 * 60 * 60 * 24 * 30, // 1 month
				count: 1000,
			},
			removeOnFail: {
				age: 1000 * 60 * 60 * 24 * 90, // 3 month
			},
			backoff: {
				type: "exponential",
				delay: 2000, // 2 seconds
			},
		});
	}
}
