import { randomUUID } from "node:crypto";

// Contas criadas pelo E2E: e-mail com prefixo próprio para o teardown apagar só elas.
export const E2E_EMAIL_PREFIX = "e2e-telas-";
export const E2E_EMAIL_DOMAIN = "@teste.slotz.dev";

export function e2eEmail(): string {
  return `${E2E_EMAIL_PREFIX}${randomUUID().slice(0, 8)}${E2E_EMAIL_DOMAIN}`;
}
