import { createTransport } from "nodemailer";
import { envConfig } from "../config/envConfig";
import { AppError } from "../error/AppError";

export interface MailPayload {
	to: string | string[];
	subject: string;
	text: string;
	html?: string;
}

export class Mailer {
	private transporter = createTransport({
		host: envConfig.MAILER_HOST,
		port: Number(envConfig.MAILER_PORT),
		secure: true,
		auth: {
			user: envConfig.MAILER_USER,
			pass: envConfig.MAILER_PASS,
		},
		logger: true,
		debug: true,
	});

	private async send(
		to: string | string[],
		subject: string,
		text: string,
		html?: string,
	) {
		try {
			console.log("Attempting to send email to:", to);
			console.log("Using SMTP user:", envConfig.MAILER_USER);

			const fromAddress = envConfig.MAILER_FROM || envConfig.MAILER_USER;

			const info = await this.transporter.sendMail({
				from: `UAU Clube <${fromAddress}>`,
				to,
				bcc: envConfig.MAILER_BCC,
				subject,
				text,
				html,
			});

			console.log("Email sent successfully: %s", info.messageId);
		} catch (error) {
			if (error instanceof Error) {
				console.error("Error sending email:", error.message);
				console.error("Full error details:", error);
			} else {
				console.error("Unexpected error:", error);
			}
			throw new AppError("Falha ao enviar email. Verifique a configuração do servidor de email.", 500);
		}
	}

	async sendMessage({ to, subject, text, html }: MailPayload) {
		await this.send(to, `UAU Clube: ${subject}`, text, html);
	}
}
