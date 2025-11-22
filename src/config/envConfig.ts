import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
	NODE_ENV: z.string(),
	MAILER_HOST: z.string(),
	MAILER_PORT: z.coerce.number(),
	MAILER_USER: z.string(),
	MAILER_PASS: z.string(),
	MAILER_BCC: z.string().optional(),
	MAILER_ADMIN_EMAIL: z.string(),
	PORT: z.coerce.number(),
	JWT_SECRET: z.string(),
	FRONTEND_URL: z.string(),
	ASAAS_API_URL: z.string(),
	ASAAS_API_KEY: z.string(),
	AWS_ACCESS_KEY: z.string(),
	AWS_SECRET_KEY: z.string(),
	AWS_S3_BUCKET_NAME: z.string(),
	AWS_S3_BUCKET_REGION: z.string(),
	REDIS_HOST: z.string(),
	REDIS_PORT: z.coerce.number(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
	console.error(
		"Invalid environment variables:",
		result.error.flatten().fieldErrors,
	);
	process.exit(1);
}

export const envConfig = result.data;
