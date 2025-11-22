import type WebhookError from "../../entities/WebhookError";

interface IWebhookErrorsRepository {
	create(data: WebhookError): Promise<WebhookError>;
	getAll(): Promise<WebhookError[]>;
}

export default IWebhookErrorsRepository;
