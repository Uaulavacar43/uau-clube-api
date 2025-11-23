// src/queues/MailingQueue.ts

import { Mailer, type MailPayload } from "../third-party/Mailer";

export class MailingQueue {
    private readonly mailer = new Mailer();

    public async addToQueue(mailPayload: MailPayload, error?: string): Promise<void> {
        // Antes: enfileirava no Redis (BullMQ) com { ...mailPayload, error }
        // O worker ignorava "error" (desestruturava como error: _).
        // Agora: envia o e-mail diretamente.
        const { to, subject, text, html } = mailPayload;

        // Se quiser, aqui daria para logar o "error" em algum lugar no futuro.
        void error;

        await this.mailer.sendMessage({ to, subject, text, html });
    }
}
