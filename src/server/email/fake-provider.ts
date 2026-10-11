import { randomUUID } from "node:crypto";
import { EmailProviderError } from "./errors";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

// Provedor em memória para testes e desenvolvimento: guarda os e-mails "enviados" e respeita a
// chave de idempotência como o provedor real (a mesma chave devolve o mesmo id, sem novo envio).

export interface FakeSentEmail extends SendEmailInput {
  externalId: string;
  sentAt: Date;
}

export class FakeEmailProvider implements EmailProvider {
  readonly source = "fake";
  readonly sentEmails: FakeSentEmail[] = [];
  private readonly byKey = new Map<string, FakeSentEmail>();

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!input.to.includes("@")) throw new EmailProviderError("rejected", "Destinatário inválido.");
    const previous = this.byKey.get(input.idempotencyKey);
    if (previous) return { externalId: previous.externalId };
    const sent: FakeSentEmail = { ...input, externalId: `fake-email-${randomUUID()}`, sentAt: new Date() };
    this.byKey.set(input.idempotencyKey, sent);
    this.sentEmails.push(sent);
    return { externalId: sent.externalId };
  }
}
