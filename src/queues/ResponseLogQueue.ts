import { Worker as BullWorker, type ConnectionOptions, Queue } from "bullmq";
import { QUEUES } from "../config/queues";
import redisConfig from "../config/redis";
import type { CreateResponseLogDto } from "../modules/log/dto/CreateResponseLogDto";
import { ResponseLogModel } from "../modules/log/models/ResponseLogModel";

const connection: ConnectionOptions = {
	host: redisConfig.host,
	port: redisConfig.port,
};

export class ResponseLogQueue {
	public queue = new Queue(QUEUES.RESPONSE_LOGS, { connection });

	private responseLogModel = new ResponseLogModel();

	public worker = new BullWorker(
		QUEUES.RESPONSE_LOGS,
		async (job) => {
			const data = job.data as CreateResponseLogDto;
			job.updateProgress(10);
			await this.responseLogModel.create(data);
			job.updateProgress(100);
		},
		{ connection },
	);

	public addToQueue(data: CreateResponseLogDto) {
		this.queue.add(QUEUES.RESPONSE_LOGS, data, {
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
