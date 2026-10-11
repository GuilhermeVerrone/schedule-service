import type { TenantScope } from "../shared";

// Contador diário de envios do número (D3, D9, D14), em `whatsapp_connections`. O consumo é um
// único UPDATE condicional: sob concorrência (dois workers), a trava da linha serializa os dois
// e o WHERE é reavaliado sobre a versão nova, então o teto nunca é ultrapassado. O "dia" vem
// pronto do fuso do tenant (`tenantDay`); contador de outro dia recomeça do zero.

export interface SendCounterState {
  timezone: string;
  firstConnectedAt: Date | null;
  manualLimit: number | null;
  sentCount: number;
  // YYYY-MM-DD no fuso do tenant, ou null se nunca enviou.
  countDate: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string): void {
  if (!DAY.test(day)) throw new RangeError(`Dia inválido: ${day}`);
}

export function createSendCounterRepository({ tenantId, db }: TenantScope) {
  return {
    // Fatos para a política de envio. Sem conexão, null.
    async getState(): Promise<SendCounterState | null> {
      const connection = await db.whatsAppConnection.findUnique({
        where: { tenantId },
        select: {
          firstConnectedAt: true,
          dailySendLimit: true,
          dailySentCount: true,
          dailyCountDate: true,
          tenant: { select: { timezone: true } },
        },
      });
      if (!connection) return null;
      return {
        timezone: connection.tenant.timezone,
        firstConnectedAt: connection.firstConnectedAt,
        manualLimit: connection.dailySendLimit,
        sentCount: connection.dailySentCount,
        countDate: connection.dailyCountDate?.toISOString().slice(0, 10) ?? null,
      };
    },

    // Consome uma vaga do dia se ainda houver (limite da política, nunca acima do teto manual).
    // Devolve a contagem nova, ou null se o teto foi atingido ou não há conexão. Um `day` mais
    // antigo que o gravado (relógio atrasado) não zera o contador.
    async consume(day: string, limit: number): Promise<number | null> {
      assertDay(day);
      if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`Limite inválido: ${limit}`);
      const rows = await db.$queryRaw<{ daily_sent_count: number }[]>`
        UPDATE "whatsapp_connections"
        SET "daily_sent_count" = CASE WHEN "daily_count_date" = ${day}::date THEN "daily_sent_count" + 1 ELSE 1 END,
            "daily_count_date" = ${day}::date,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid
          AND ("daily_count_date" IS NULL OR "daily_count_date" <= ${day}::date)
          AND (CASE WHEN "daily_count_date" = ${day}::date THEN "daily_sent_count" ELSE 0 END)
              < LEAST(${limit}::int, COALESCE("daily_send_limit", ${limit}::int))
        RETURNING "daily_sent_count"`;
      return rows[0]?.daily_sent_count ?? null;
    },

    // Devolve a vaga de um envio que falhou de vez (D10: falha final não gasta o teto). Só no
    // mesmo dia: vaga de ontem não volta.
    async release(day: string): Promise<boolean> {
      assertDay(day);
      const count = await db.$executeRaw`
        UPDATE "whatsapp_connections"
        SET "daily_sent_count" = "daily_sent_count" - 1, "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "daily_count_date" = ${day}::date
          AND "daily_sent_count" > 0`;
      return count > 0;
    },
  };
}
