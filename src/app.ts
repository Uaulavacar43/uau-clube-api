import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cors from "cors"; // Importa cors
import express from "express";
import { errorHandler } from "./middlewares/ErrorHandler";
import { requestLogMiddleware } from "./middlewares/requestLogMiddleware";
import { configureHandlebars } from "./modules/docs";
import { ErrorLogQueue } from "./queues/ErrorLogQueue";
import { MailingQueue } from "./queues/MailingQueue";
import { RequestLogQueue } from "./queues/RequestLogQueue";
import { ResponseLogQueue } from "./queues/ResponseLogQueue";
import { WebhookLogQueue } from "./queues/WebhookLogQueue";
import routes from "./routes";

const app = express();

// Enable trust proxy - this is needed when the app is behind a reverse proxy
// It allows express-rate-limit to use X-Forwarded-For header for client IP
app.set("trust proxy", 1);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

const mailingQueue = new MailingQueue();
const errorLogQueue = new ErrorLogQueue();
const requestLogQueue = new RequestLogQueue();
const responseLogQueue = new ResponseLogQueue();
const webhookLogQueue = new WebhookLogQueue();

createBullBoard({
	queues: [
		new BullMQAdapter(mailingQueue.queue),
		new BullMQAdapter(errorLogQueue.queue),
		new BullMQAdapter(requestLogQueue.queue),
		new BullMQAdapter(responseLogQueue.queue),
		new BullMQAdapter(webhookLogQueue.queue),
	],
	serverAdapter,
	options: {
		uiConfig: {
			boardTitle: "UAU Clube",
		},
	},
});

app.use("/admin/queues", serverAdapter.getRouter());

// Configura CORS con las opciones necesarias (puedes personalizarlo)
app.use(
	cors({
		origin(_requestOrigin, callback) {
			callback(null, true);
		},
	}),
); // Usar CORS

app.use(requestLogMiddleware);

app.use(express.json());

// Configurar Handlebars para a documentação
configureHandlebars(app);

app.use("/", routes);
app.use(errorHandler);

export default app;
