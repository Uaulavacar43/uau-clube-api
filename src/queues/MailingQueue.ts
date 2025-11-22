import { Worker as BullWorker, type ConnectionOptions, Queue } from "bullmq";
import { QUEUES } from "../config/queues";
import redisConfig from "../config/redis";
import { Mailer, type MailPayload } from "../third-party/Mailer";

const connection: ConnectionOptions = {
	host: redisConfig.host,
	port: redisConfig.port,
};

export class MailingQueue {
	public queue = new Queue(QUEUES.MAILING, { connection });

	private mailer = new Mailer();

	public worker = new BullWorker(
		QUEUES.MAILING,
		async (job) => {
			const {
				to,
				subject,
				text,
				html,
				error: _,
			} = job.data as MailPayload & { error?: string };
			job.updateProgress(10);
			await this.mailer.sendMessage({ to, subject, text, html });
			job.updateProgress(100);
		},
		{ connection },
	);

	public addToQueue(mailPayload: MailPayload, error?: string) {
		this.queue.add(
			QUEUES.MAILING,
			{ ...mailPayload, error },
			{
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
			},
		);
	}
}
