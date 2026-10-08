import {
  createAuthRepository,
  UniqueViolationError,
  type AuthRepository,
  type Profile,
} from "@/server/repositories/auth-repository";
import { loginSchema, registerSchema } from "@/server/validation/auth";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { isLoginBlocked } from "./rate-limit";
import { issueSession, revokeSession } from "./session";
import { nextFreeSlug, slugify } from "./slug";

// Cadastro, login e logout do dono (guia 7a, 7b). Entrada não validada lança ZodError.

export class EmailInUseError extends Error {
  constructor() {
    super("E-mail já cadastrado");
    this.name = "EmailInUseError";
  }
}

// Mesma mensagem para e-mail inexistente e senha errada (premissa e).
export class InvalidCredentialsError extends Error {
  constructor() {
    super("E-mail ou senha incorretos");
    this.name = "InvalidCredentialsError";
  }
}

export class TooManyAttemptsError extends Error {
  constructor() {
    super("Muitas tentativas de login");
    this.name = "TooManyAttemptsError";
  }
}

export interface AuthResult extends Profile {
  session: { token: string; expiresAt: Date };
}

// Duas pessoas cadastrando o mesmo nome ao mesmo tempo: a perdedora tenta o próximo sufixo.
const SLUG_ATTEMPTS = 5;

export async function register(
  input: unknown,
  repo: AuthRepository = createAuthRepository(),
): Promise<AuthResult> {
  const { businessName, email, password } = registerSchema.parse(input);
  if (await repo.findUserByEmail(email)) throw new EmailInUseError();

  const passwordHash = await hashPassword(password);
  const base = slugify(businessName);

  for (let attempt = 1; ; attempt++) {
    const slug = nextFreeSlug(base, await repo.slugsLike(base));
    const issued = issueSession();
    try {
      const account = await repo.createOwnerAccount({
        tenantName: businessName,
        slug,
        email,
        passwordHash,
        session: { tokenHash: issued.tokenHash, expiresAt: issued.expiresAt },
      });
      return {
        user: account.user,
        tenant: account.tenant,
        session: { token: issued.token, expiresAt: account.session.expiresAt },
      };
    } catch (error) {
      if (!(error instanceof UniqueViolationError)) throw error;
      if (error.field === "email") throw new EmailInUseError();
      if (error.field !== "slug" || attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}

export async function login(
  input: unknown,
  ip: string,
  repo: AuthRepository = createAuthRepository(),
): Promise<AuthResult> {
  const { email, password } = loginSchema.parse(input);
  // Bloqueado não conta nova tentativa: senão o bloqueio se estenderia sozinho.
  if (await isLoginBlocked(email, ip, new Date(), repo)) throw new TooManyAttemptsError();

  const user = await repo.findUserByEmail(email);
  const ok = user ? await verifyPassword(user.passwordHash, password) : await burnPasswordCheck(password);
  await repo.recordLoginAttempt(email, ip, ok);
  if (!user || !ok) throw new InvalidCredentialsError();

  const issued = issueSession();
  const session = await repo.createSession(user.tenantId, user.id, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
  });
  const profile = await repo.findProfile(user.tenantId, user.id);
  if (!profile) throw new InvalidCredentialsError();
  return { ...profile, session: { token: issued.token, expiresAt: session.expiresAt } };
}

export function logout(token: string | undefined, repo: AuthRepository = createAuthRepository()): Promise<void> {
  return revokeSession(token ?? "", repo);
}
