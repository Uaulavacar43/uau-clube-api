import { Worker as BullWorker, type ConnectionOptions, Queue } from "bullmq";
import { QUEUES } from "../config/queues";
import redisConfig from "../config/redis";
import type { CreateWebhookLogDto } from "../modules/log/dto/CreateWebhookLogDto";
import { WebhookLogModel } from "../modules/log/models/WebhookLogModel";

const connection: ConnectionOptions = {
	host: redisConfig.host,
	port: redisConfig.port,
};

export class WebhookLogQueue {
	public queue = new Queue(QUEUES.WEBHOOK_LOGS, { connection });

	private webhookLogModel = new WebhookLogModel();

	public worker = new BullWorker(
		QUEUES.WEBHOOK_LOGS,
		async (job) => {
			const data = job.data as CreateWebhookLogDto;
			job.updateProgress(10);
			await this.webhookLogModel.create(data);
			job.updateProgress(100);
		},
		{ connection },
	);

	public addToQueue(data: CreateWebhookLogDto) {
		this.queue.add(QUEUES.WEBHOOK_LOGS, data, {
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
