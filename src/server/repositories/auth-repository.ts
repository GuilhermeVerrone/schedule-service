import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Tenant, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Acesso pré-autenticação (D1, premissas a-e). Aqui o tenant ainda não é conhecido: o login
// busca o usuário pelo e-mail (único globalmente) e a sessão pelo hash do token. Depois disso
// todo acesso a dados de negócio passa por createTenantRepository(tenantId).

export class UniqueViolationError extends Error {
  constructor(readonly field: "email" | "slug" | "unknown") {
    super(`Valor duplicado em ${field}`);
    this.name = "UniqueViolationError";
  }
}

// Com o driver adapter, meta traz o índice violado (driverAdapterError.cause.constraint.index);
// sem ele, meta.target lista os campos. Procura os dois no meta serializado.
function asUniqueViolation(error: unknown): UniqueViolationError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = JSON.stringify(error.meta ?? {});
  if (/users_email_key|"email"/.test(meta)) return new UniqueViolationError("email");
  if (/tenants_slug_key|"slug"/.test(meta)) return new UniqueViolationError("slug");
  return new UniqueViolationError("unknown");
}

export type PublicUser = Pick<User, "id" | "email" | "role">;
export type PublicTenant = Pick<Tenant, "id" | "name" | "slug" | "timezone">;

export interface Profile {
  user: PublicUser;
  tenant: PublicTenant;
}

export interface SessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  expiresAt: Date;
}

export interface NewSession {
  tokenHash: string;
  expiresAt: Date;
}

export interface NewOwnerAccount {
  tenantName: string;
  slug: string;
  email: string;
  passwordHash: string;
  session: NewSession;
}

const publicUser = { id: true, email: true, role: true } as const;
const publicTenant = { id: true, name: true, slug: true, timezone: true } as const;
const sessionFields = { id: true, tenantId: true, userId: true, expiresAt: true } as const;

export function createAuthRepository(db: PrismaClient = prisma) {
  return {
    findUserByEmail(email: string) {
      return db.user.findUnique({
        where: { email },
        select: { ...publicUser, tenantId: true, passwordHash: true },
      });
    },

    async findProfile(tenantId: string, userId: string): Promise<Profile | null> {
      const user = await db.user.findFirst({
        where: { id: userId, tenantId },
        select: { ...publicUser, tenant: { select: publicTenant } },
      });
      if (!user) return null;
      const { tenant, ...rest } = user;
      return { user: rest, tenant };
    },

    async slugsLike(base: string): Promise<string[]> {
      const rows = await db.tenant.findMany({
        where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
        select: { slug: true },
      });
      return rows.map((row) => row.slug);
    },

    // Tenant, dono e primeira sessão nascem juntos ou nenhum nasce (premissa b).
    async createOwnerAccount(input: NewOwnerAccount): Promise<Profile & { session: SessionRecord }> {
      try {
        return await db.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { name: input.tenantName, slug: input.slug },
            select: publicTenant,
          });
          const user = await tx.user.create({
            data: { tenantId: tenant.id, email: input.email, passwordHash: input.passwordHash, role: "owner" },
            select: publicUser,
          });
          const session = await tx.session.create({
            data: { tenantId: tenant.id, userId: user.id, ...input.session },
            select: sessionFields,
          });
          return { tenant, user, session };
        });
      } catch (error) {
        throw asUniqueViolation(error) ?? error;
      }
    },

    createSession(tenantId: string, userId: string, session: NewSession): Promise<SessionRecord> {
      return db.session.create({ data: { tenantId, userId, ...session }, select: sessionFields });
    },

    // Sessão vencida se comporta como inexistente.
    findActiveSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
      return db.session.findFirst({
        where: { tokenHash, expiresAt: { gt: now } },
        select: sessionFields,
      });
    },

    async extendSession(id: string, expiresAt: Date): Promise<void> {
      await db.session.update({ where: { id }, data: { expiresAt } });
    },

    async deleteSession(tokenHash: string): Promise<void> {
      await db.session.deleteMany({ where: { tokenHash } });
    },

    async recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
      await db.loginAttempt.create({ data: { email, ip, success } });
    },

    // Falhas do e-mail na janela, contadas a partir do último login bem-sucedido.
    async countEmailFailures(email: string, since: Date): Promise<number> {
      const lastSuccess = await db.loginAttempt.findFirst({
        where: { email, success: true, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return db.loginAttempt.count({
        where: { email, success: false, createdAt: { gt: lastSuccess?.createdAt ?? since } },
      });
    },

    countIpFailures(ip: string, since: Date): Promise<number> {
      return db.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } });
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
