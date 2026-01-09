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
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    MAILER_HOST: z.string().min(1, "MAILER_HOST is required"),
    MAILER_PORT: z.coerce.number(),
    MAILER_USER: z.string().min(1, "MAILER_USER is required"),
    MAILER_PASS: z.string().min(1, "MAILER_PASS is required"),
    MAILER_BCC: z.string().optional(),

    // Se não vier nada, usa o próprio MAILER_USER como e-mail admin.
    MAILER_ADMIN_EMAIL: z
        .string()
        .default(process.env.MAILER_USER ?? "uau-clube@roomcompany.co"),

    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

    ASAAS_API_URL: z.string().min(1, "ASAAS_API_URL is required"),
    ASAAS_API_KEY: z.string().min(1, "ASAAS_API_KEY is required"),

    // Google Cloud Storage
    GCS_BUCKET_NAME: z.string().min(1, "GCS_BUCKET_NAME is required"),
    GOOGLE_CLOUD_PROJECT: z.string().min(1, "GOOGLE_CLOUD_PROJECT is required"),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
    console.error(
        "Invalid environment variables:",
        result.error.flatten().fieldErrors,
    );
    console.error("Please check your .env file and ensure all required variables are set.");
    // Não encerra o processo imediatamente - permite ver o erro completo
    process.exit(1);
}

export const envConfig = result.data;
