import { createAuthRepository, type AuthRepository } from "@/server/repositories/auth-repository";

// Limite de tentativas de login em tabela Postgres (D1, premissa d), por e-mail e por IP,
// numa janela móvel. Bloqueado, nem a senha certa entra até a janela passar.

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Falhas por e-mail desde o último login bem-sucedido (dentro da janela).
export const MAX_FAILURES_PER_EMAIL = 5;
// Falhas por IP, somando todos os e-mails (tentativa de varrer contas).
export const MAX_FAILURES_PER_IP = 20;

export async function isLoginBlocked(
  email: string,
  ip: string,
  now: Date = new Date(),
  repo: AuthRepository = createAuthRepository(),
): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [emailFailures, ipFailures] = await Promise.all([
    repo.countEmailFailures(email, since),
    repo.countIpFailures(ip, since),
  ]);
  return emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP;
}
