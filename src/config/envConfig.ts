// src/config/envConfig.ts

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
    NODE_ENV: z.string().default("development"),

    PORT: z.coerce.number().default(3002),
    FRONTEND_URL: z.string().default("http://localhost:5173"),

    // Prisma usa diretamente process.env.DATABASE_URL,
    // mas garantimos que está presente.
    DATABASE_URL: z.string(),

    MAILER_HOST: z.string(),
    MAILER_PORT: z.coerce.number(),
    MAILER_USER: z.string(),
    MAILER_PASS: z.string(),
    MAILER_BCC: z.string().optional(),
    MAILER_ADMIN_EMAIL: z.string(),

    JWT_SECRET: z.string(),

    ASAAS_API_URL: z.string(),
    ASAAS_API_KEY: z.string(),

    REDIS_HOST: z.string().default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().default(6379),

    // Google Cloud Storage
    GCS_BUCKET_NAME: z.string(),
    GOOGLE_CLOUD_PROJECT: z.string(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
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
