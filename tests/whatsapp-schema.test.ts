import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Restrições do WhatsApp direto no SQL (guia 5; D7, D8), contornando repositório e Prisma: o banco
// tem de recusar sozinho o que o código deixar passar. Roda na branch test (DATABASE_URL do Vitest).

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

let client: pg.Client;
const tenantIds: string[] = [];

interface Fixture {
  tenantId: string;
  contactId: string;
  conversationId: string;
}

let a: Fixture;
let b: Fixture;

async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`${sql} returning id`, params);
  return rows[0].id;
}

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const unique = (label: string) => `${label}-${randomUUID()}`;

function insertTenant(label: string): Promise<string> {
  return insertReturningId(
    `insert into tenants (id, name, slug, updated_at) values (gen_random_uuid(), $1, $2, now())`,
    [`Teste ${label}`, `teste-whatsapp-${label}-${randomUUID().slice(0, 8)}`],
  ).then((id) => {
    tenantIds.push(id);
    return id;
  });
}

function insertContact(tenantId: string, phone: string): Promise<string> {
  return insertReturningId(
    `insert into contacts (id, tenant_id, name, phone, updated_at) values (gen_random_uuid(), $1, 'Cliente', $2, now())`,
    [tenantId, phone],
  );
}

function insertConversation(tenantId: string, contactId: string): Promise<string> {
  return insertReturningId(
    `insert into conversations (id, tenant_id, contact_id, updated_at) values (gen_random_uuid(), $1, $2, now())`,
    [tenantId, contactId],
  );
}

function insertConnection(tenantId: string, sessionId: string, status = "disconnected"): Promise<string> {
  return insertReturningId(
    `insert into whatsapp_connections (id, tenant_id, session_id, status, updated_at)
     values (gen_random_uuid(), $1, $2, $3, now())`,
    [tenantId, sessionId, status],
  );
}

interface NewMessage {
  tenantId?: string;
  conversationId?: string;
  direction?: string;
  status?: string;
  body?: string | null;
  mediaType?: string | null;
  externalId?: string | null;
}

function insertMessage(f: Fixture, input: NewMessage = {}): Promise<string> {
  const direction = input.direction ?? "inbound";
  return insertReturningId(
    `insert into messages (id, tenant_id, conversation_id, direction, body, media_type, status, external_id, sent_at, updated_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())`,
    [
      input.tenantId ?? f.tenantId,
      input.conversationId ?? f.conversationId,
      direction,
      input.body === undefined ? "Oi" : input.body,
      input.mediaType ?? null,
      input.status ?? (direction === "inbound" ? "received" : "pending"),
      input.externalId === undefined ? unique("wamid") : input.externalId,
    ],
  );
}

function insertWebhookEvent(tenantId: string, source: string, eventId: string): Promise<string> {
  return insertReturningId(
    `insert into webhook_events (id, tenant_id, source, event_id, updated_at) values (gen_random_uuid(), $1, $2, $3, now())`,
    [tenantId, source, eventId],
  );
}

async function createFixture(label: string): Promise<Fixture> {
  const tenantId = await insertTenant(label);
  const contactId = await insertContact(tenantId, "+5511987654321");
  return { tenantId, contactId, conversationId: await insertConversation(tenantId, contactId) };
}

beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  a = await createFixture("a");
  b = await createFixture("b");
});

afterAll(async () => {
  if (tenantIds.length > 0) await client.query(`delete from tenants where id = any($1::uuid[])`, [tenantIds]);
  await client.end();
});

describe("whatsapp_connections", () => {
  it("aceita uma conexão por tenant e recusa a segunda", async () => {
    const tenantId = await insertTenant("conexao");
    await insertConnection(tenantId, unique("sessao"));
    expect(await pgErrorCode(insertConnection(tenantId, unique("sessao")))).toBe(UNIQUE_VIOLATION);
  });

  it("recusa o mesmo session_id em outro tenant", async () => {
    const sessionId = unique("sessao");
    await insertConnection(await insertTenant("sessao-1"), sessionId);
    expect(await pgErrorCode(insertConnection(await insertTenant("sessao-2"), sessionId))).toBe(UNIQUE_VIOLATION);
  });

  it("nasce desconectada, com contador zerado e sem teto manual (D14 da Fatia 4)", async () => {
    const tenantId = await insertTenant("padrao");
    const id = await insertReturningId(
      `insert into whatsapp_connections (id, tenant_id, session_id, updated_at) values (gen_random_uuid(), $1, $2, now())`,
      [tenantId, unique("sessao")],
    );
    const { rows } = await client.query(
      `select status, daily_sent_count, daily_count_date, daily_send_limit, last_checked_at
       from whatsapp_connections where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: "disconnected",
      daily_sent_count: 0,
      daily_count_date: null,
      daily_send_limit: null,
      last_checked_at: null,
    });
  });

  it("aceita só os status do guia", async () => {
    for (const status of ["connected", "disconnected", "qr_pending", "banned_suspected"]) {
      await insertConnection(await insertTenant(`status-${status}`), unique("sessao"), status);
    }
    for (const status of ["banned", "CONNECTED", ""]) {
      expect(await pgErrorCode(insertConnection(await insertTenant("status-ruim"), unique("sessao"), status))).toBe(
        CHECK_VIOLATION,
      );
    }
  });

  it("recusa session_id vazio, contador negativo e limite zero", async () => {
    expect(await pgErrorCode(insertConnection(await insertTenant("sessao-vazia"), ""))).toBe(CHECK_VIOLATION);
    const id = await insertConnection(await insertTenant("contador"), unique("sessao"));
    expect(
      await pgErrorCode(client.query(`update whatsapp_connections set daily_sent_count = -1 where id = $1`, [id])),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(client.query(`update whatsapp_connections set daily_send_limit = 0 where id = $1`, [id])),
    ).toBe(CHECK_VIOLATION);
  });
});

describe("conversations", () => {
  it("recusa contato de outro tenant (FK composta)", async () => {
    expect(await pgErrorCode(insertConversation(a.tenantId, b.contactId))).toBe(FK_VIOLATION);
  });

  it("recusa segunda conversa para o mesmo contato", async () => {
    expect(await pgErrorCode(insertConversation(a.tenantId, a.contactId))).toBe(UNIQUE_VIOLATION);
  });

  it("não deixa mover a conversa para outro tenant", async () => {
    expect(
      await pgErrorCode(
        client.query(`update conversations set tenant_id = $1 where id = $2`, [b.tenantId, a.conversationId]),
      ),
    ).toBe(FK_VIOLATION);
  });
});

describe("messages", () => {
  it("recusa o mesmo id externo duas vezes no tenant (idempotência)", async () => {
    const externalId = unique("wamid");
    await insertMessage(a, { externalId });
    expect(await pgErrorCode(insertMessage(a, { externalId }))).toBe(UNIQUE_VIOLATION);
    // Enviada também conta: o id externo é único por tenant, em qualquer direção.
    expect(await pgErrorCode(insertMessage(a, { externalId, direction: "outbound", status: "sent" }))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("aceita o mesmo id externo em outro tenant", async () => {
    const externalId = unique("wamid");
    await insertMessage(a, { externalId });
    await insertMessage(b, { externalId });
    const { rows } = await client.query(`select count(*)::int as n from messages where external_id = $1`, [externalId]);
    expect(rows[0].n).toBe(2);
  });

  it("recusa conversa de outro tenant (FK composta)", async () => {
    expect(await pgErrorCode(insertMessage(a, { conversationId: b.conversationId }))).toBe(FK_VIOLATION);
    expect(await pgErrorCode(insertMessage(b, { tenantId: a.tenantId }))).toBe(FK_VIOLATION);
  });

  it("exige id externo na recebida e aceita enviada sem confirmação, várias vezes", async () => {
    expect(await pgErrorCode(insertMessage(a, { externalId: null }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertMessage(a, { externalId: "" }))).toBe(CHECK_VIOLATION);
    await insertMessage(a, { direction: "outbound", externalId: null });
    await insertMessage(a, { direction: "outbound", externalId: null });
  });

  it("aceita só direção e status coerentes", async () => {
    expect(await pgErrorCode(insertMessage(a, { direction: "incoming", status: "received" }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertMessage(a, { direction: "inbound", status: "sent" }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertMessage(a, { direction: "outbound", status: "received" }))).toBe(CHECK_VIOLATION);
    for (const status of ["pending", "sent", "delivered", "read", "failed"]) {
      await insertMessage(a, { direction: "outbound", status });
    }
  });

  it("guarda mídia só como tipo e exige texto ou mídia", async () => {
    for (const mediaType of ["image", "audio", "video", "document", "sticker", "other"]) {
      await insertMessage(a, { body: null, mediaType });
    }
    expect(await pgErrorCode(insertMessage(a, { body: null, mediaType: "https://cdn/x.jpg" }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertMessage(a, { body: null, mediaType: null }))).toBe(CHECK_VIOLATION);
  });

  it("apagar o contato apaga a conversa e as mensagens (LGPD)", async () => {
    const tenantId = await insertTenant("cascata");
    const contactId = await insertContact(tenantId, "+5511912345678");
    const fixture = { tenantId, contactId, conversationId: await insertConversation(tenantId, contactId) };
    await insertMessage(fixture);
    await client.query(`delete from contacts where id = $1`, [contactId]);
    const { rows } = await client.query(
      `select (select count(*) from conversations where tenant_id = $1)::int as conversas,
              (select count(*) from messages where tenant_id = $1)::int as mensagens`,
      [tenantId],
    );
    expect(rows[0]).toEqual({ conversas: 0, mensagens: 0 });
  });
});

describe("webhook_events", () => {
  it("recusa o mesmo evento da mesma origem, mesmo vindo para outro tenant", async () => {
    const eventId = unique("evento");
    await insertWebhookEvent(a.tenantId, "akg", eventId);
    expect(await pgErrorCode(insertWebhookEvent(a.tenantId, "akg", eventId))).toBe(UNIQUE_VIOLATION);
    expect(await pgErrorCode(insertWebhookEvent(b.tenantId, "akg", eventId))).toBe(UNIQUE_VIOLATION);
  });

  it("aceita o mesmo id de evento em outra origem", async () => {
    const eventId = unique("evento");
    await insertWebhookEvent(a.tenantId, "akg", eventId);
    await insertWebhookEvent(a.tenantId, "asaas", eventId);
  });

  it("recusa origem fora do formato e id de evento vazio", async () => {
    for (const source of ["AKG", "", "akg sessao", "1akg"]) {
      expect(await pgErrorCode(insertWebhookEvent(a.tenantId, source, unique("evento")))).toBe(CHECK_VIOLATION);
    }
    expect(await pgErrorCode(insertWebhookEvent(a.tenantId, "akg", ""))).toBe(CHECK_VIOLATION);
  });

  it("recusa tenant inexistente", async () => {
    expect(await pgErrorCode(insertWebhookEvent(randomUUID(), "akg", unique("evento")))).toBe(FK_VIOLATION);
  });
});
