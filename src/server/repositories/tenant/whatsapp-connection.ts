import { Prisma, type WhatsAppConnection } from "@/generated/prisma/client";
import {
  connectionInputSchema,
  connectionStatusInputSchema,
  type ConnectionInput,
} from "@/server/validation/whatsapp";
import type { ConnectionState } from "@/server/whatsapp";
import type { TenantScope } from "../shared";

// Conexão do WhatsApp do tenant (guia 5): uma por tenant, sem ID na API. O `sessionId` é único
// no banco: um tenant nunca assume a sessão de outro (D8), recebe SessionIdTakenError.

export class SessionIdTakenError extends Error {
  constructor() {
    super("Sessão do WhatsApp já pertence a outra conexão");
    this.name = "SessionIdTakenError";
  }
}

const isSessionIdTaken = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  JSON.stringify(error.meta ?? {}).includes("session_id");

export function createWhatsAppConnectionRepository({ tenantId, db }: TenantScope) {
  return {
    get(): Promise<WhatsAppConnection | null> {
      return db.whatsAppConnection.findUnique({ where: { tenantId } });
    },

    // Cria a conexão ou troca a sessão e o estado da existente (connect/reconnect).
    async save(input: ConnectionInput): Promise<WhatsAppConnection> {
      const { sessionId, status, checkedAt } = connectionInputSchema.parse(input);
      const data = { sessionId, status, lastCheckedAt: checkedAt ?? new Date() };
      try {
        return await db.whatsAppConnection.upsert({
          where: { tenantId },
          create: { ...data, tenantId },
          update: data,
        });
      } catch (error) {
        if (isSessionIdTaken(error)) throw new SessionIdTakenError();
        throw error;
      }
    },

    // Atualiza só o estado (getStatus, desconectar). Sem conexão, null.
    async setStatus(status: ConnectionState, checkedAt?: Date): Promise<WhatsAppConnection | null> {
      const data = connectionStatusInputSchema.parse({ status, checkedAt });
      const { count } = await db.whatsAppConnection.updateMany({
        where: { tenantId },
        data: { status: data.status, lastCheckedAt: data.checkedAt ?? new Date() },
      });
      return count === 0 ? null : db.whatsAppConnection.findUnique({ where: { tenantId } });
    },
  };
}
