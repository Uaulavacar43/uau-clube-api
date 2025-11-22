import { Worker as BullWorker, type ConnectionOptions, Queue } from "bullmq";
import { QUEUES } from "../config/queues";
import redisConfig from "../config/redis";
import type { CreateRequestLogDto } from "../modules/log/dto/CreateRequestLogDto";
import { RequestLogModel } from "../modules/log/models/RequestLogModel";

const connection: ConnectionOptions = {
	host: redisConfig.host,
	port: redisConfig.port,
};

export class RequestLogQueue {
	public queue = new Queue(QUEUES.REQUEST_LOGS, { connection });

	private requestLogModel = new RequestLogModel();

	public worker = new BullWorker(
		QUEUES.REQUEST_LOGS,
		async (job) => {
			const data = job.data as CreateRequestLogDto;
			job.updateProgress(10);
			await this.requestLogModel.create(data);
			job.updateProgress(100);
		},
		{ connection },
	);

	public addToQueue(data: CreateRequestLogDto) {
		this.queue.add(QUEUES.REQUEST_LOGS, data, {
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
