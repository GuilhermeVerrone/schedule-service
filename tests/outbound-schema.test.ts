import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Restrições da fila de envio direto no SQL (guia 5; D3, D5, D14, D15, D16), contornando repositório
// e Prisma: o banco tem de recusar sozinho o que o código deixar passar. Roda na branch test.

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

let client: pg.Client;
const tenantIds: string[] = [];

interface Fixture {
  tenantId: string;
  contactId: string;
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

async function insertTenant(label: string): Promise<string> {
  const id = await insertReturningId(
    `insert into tenants (id, name, slug, updated_at) values (gen_random_uuid(), $1, $2, now())`,
    [`Teste ${label}`, `teste-envio-${label}-${randomUUID().slice(0, 8)}`],
  );
  tenantIds.push(id);
  return id;
}

function insertContact(tenantId: string, phone: string): Promise<string> {
  return insertReturningId(
    `insert into contacts (id, tenant_id, name, phone, updated_at) values (gen_random_uuid(), $1, 'Cliente', $2, now())`,
    [tenantId, phone],
  );
}

interface NewOutbound {
  tenantId?: string;
  contactId?: string;
  messageType?: string;
  channel?: string | null;
  status?: string;
  blockReason?: string | null;
  idempotencyKey?: string;
  externalId?: string | null;
  sentAt?: Date | null;
  templateVariant?: number | null;
}

function insertOutbound(f: Fixture, input: NewOutbound = {}): Promise<string> {
  return insertReturningId(
    `insert into outbound_messages (id, tenant_id, contact_id, message_type, channel, status, block_reason,
       idempotency_key, external_id, sent_at, template_variant, updated_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [
      input.tenantId ?? f.tenantId,
      input.contactId ?? f.contactId,
      input.messageType ?? "appointment_confirmation",
      input.channel === undefined ? null : input.channel,
      input.status ?? "queued",
      input.blockReason ?? null,
      input.idempotencyKey ?? unique("evento"),
      input.externalId ?? null,
      input.sentAt ?? null,
      input.templateVariant ?? null,
    ],
  );
}

const VARIATIONS = ["Oi {{nome}}", "Olá {{nome}}", "E aí, {{nome}}"];

function insertTemplate(tenantId: string, messageType = "appointment_confirmation", variations: unknown = VARIATIONS) {
  return insertReturningId(
    `insert into message_templates (id, tenant_id, message_type, variations, updated_at)
     values (gen_random_uuid(), $1, $2, $3, now())`,
    [tenantId, messageType, variations],
  );
}

async function createFixture(label: string): Promise<Fixture> {
  const tenantId = await insertTenant(label);
  return { tenantId, contactId: await insertContact(tenantId, "+5511987654321") };
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

describe("outbound_messages", () => {
  it("nasce na fila, agendado para agora, sem canal nem envio", async () => {
    const id = await insertReturningId(
      `insert into outbound_messages (id, tenant_id, contact_id, message_type, idempotency_key, updated_at)
       values (gen_random_uuid(), $1, $2, 'appointment_confirmation', $3, now())`,
      [a.tenantId, a.contactId, unique("evento")],
    );
    const { rows } = await client.query(
      `select status, channel, block_reason, sent_at, external_id,
              abs(extract(epoch from scheduled_for - now())) < 60 as agendado_agora
       from outbound_messages where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: "queued",
      channel: null,
      block_reason: null,
      sent_at: null,
      external_id: null,
      agendado_agora: true,
    });
  });

  it("recusa a mesma chave de idempotência duas vezes no tenant", async () => {
    const idempotencyKey = unique("appointment_confirmation");
    await insertOutbound(a, { idempotencyKey });
    expect(await pgErrorCode(insertOutbound(a, { idempotencyKey }))).toBe(UNIQUE_VIOLATION);
    // Vale para qualquer status: um evento bloqueado não pode ser reenfileirado com a mesma chave.
    expect(await pgErrorCode(insertOutbound(a, { idempotencyKey, status: "blocked", blockReason: "opt_out" }))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("aceita a mesma chave de idempotência em outro tenant", async () => {
    const idempotencyKey = unique("appointment_confirmation");
    await insertOutbound(a, { idempotencyKey });
    await insertOutbound(b, { idempotencyKey });
    const { rows } = await client.query(`select count(*)::int as n from outbound_messages where idempotency_key = $1`, [
      idempotencyKey,
    ]);
    expect(rows[0].n).toBe(2);
  });

  it("recusa chave de idempotência vazia ou longa demais", async () => {
    expect(await pgErrorCode(insertOutbound(a, { idempotencyKey: "" }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertOutbound(a, { idempotencyKey: "x".repeat(256) }))).toBe(CHECK_VIOLATION);
    await insertOutbound(a, { idempotencyKey: `${"x".repeat(250)}${randomUUID().slice(0, 5)}` });
  });

  it("recusa contato de outro tenant (FK composta), nos dois sentidos", async () => {
    expect(await pgErrorCode(insertOutbound(a, { contactId: b.contactId }))).toBe(FK_VIOLATION);
    expect(await pgErrorCode(insertOutbound(b, { tenantId: a.tenantId }))).toBe(FK_VIOLATION);
  });

  it("não deixa mover o envio para outro tenant nem para contato de outro tenant", async () => {
    const id = await insertOutbound(a);
    expect(
      await pgErrorCode(client.query(`update outbound_messages set tenant_id = $1 where id = $2`, [b.tenantId, id])),
    ).toBe(FK_VIOLATION);
    expect(
      await pgErrorCode(client.query(`update outbound_messages set contact_id = $1 where id = $2`, [b.contactId, id])),
    ).toBe(FK_VIOLATION);
  });

  it("aceita só os status do guia", async () => {
    await insertOutbound(a, { status: "queued" });
    await insertOutbound(a, { status: "sent", channel: "whatsapp", sentAt: new Date() });
    await insertOutbound(a, { status: "failed", channel: "whatsapp" });
    await insertOutbound(a, { status: "blocked", blockReason: "no_channel" });
    await insertOutbound(a, { status: "expired" });
    for (const status of ["pending", "SENT", "canceled", ""]) {
      expect(await pgErrorCode(insertOutbound(a, { status }))).toBe(CHECK_VIOLATION);
    }
  });

  it("aceita só os canais whatsapp e email", async () => {
    await insertOutbound(a, { channel: "whatsapp" });
    await insertOutbound(a, { channel: "email" });
    for (const channel of ["sms", "WhatsApp", ""]) {
      expect(await pgErrorCode(insertOutbound(a, { channel }))).toBe(CHECK_VIOLATION);
    }
  });

  it("aceita só tipos da lista fechada, sem tipo livre (D16)", async () => {
    await insertOutbound(a, { messageType: "optout_confirmation" });
    for (const messageType of ["campaign", "promo", "payment_reminder", "", "APPOINTMENT_CONFIRMATION"]) {
      expect(await pgErrorCode(insertOutbound(a, { messageType }))).toBe(CHECK_VIOLATION);
    }
  });

  it("exige motivo no bloqueio e só no bloqueio, em formato de código", async () => {
    expect(await pgErrorCode(insertOutbound(a, { status: "blocked", blockReason: null }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertOutbound(a, { status: "queued", blockReason: "opt_out" }))).toBe(CHECK_VIOLATION);
    for (const blockReason of ["Opt out", "opt-out", "", "1motivo", "x".repeat(65)]) {
      expect(await pgErrorCode(insertOutbound(a, { status: "blocked", blockReason }))).toBe(CHECK_VIOLATION);
    }
    for (const blockReason of ["opt_out", "not_eligible", "no_channel"]) {
      await insertOutbound(a, { status: "blocked", blockReason });
    }
  });

  it("enviada exige canal e horário de envio; horário de envio só na enviada", async () => {
    expect(await pgErrorCode(insertOutbound(a, { status: "sent", channel: "whatsapp", sentAt: null }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await pgErrorCode(insertOutbound(a, { status: "sent", channel: null, sentAt: new Date() }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await pgErrorCode(insertOutbound(a, { status: "queued", sentAt: new Date() }))).toBe(CHECK_VIOLATION);
  });

  it("recusa id externo vazio e variação negativa", async () => {
    expect(await pgErrorCode(insertOutbound(a, { externalId: "" }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertOutbound(a, { templateVariant: -1 }))).toBe(CHECK_VIOLATION);
    await insertOutbound(a, { templateVariant: 0 });
  });

  it("apagar o contato apaga os envios dele (LGPD)", async () => {
    const tenantId = await insertTenant("cascata");
    const fixture = { tenantId, contactId: await insertContact(tenantId, "+5511912345678") };
    await insertOutbound(fixture);
    await client.query(`delete from contacts where id = $1`, [fixture.contactId]);
    const { rows } = await client.query(`select count(*)::int as n from outbound_messages where tenant_id = $1`, [
      tenantId,
    ]);
    expect(rows[0].n).toBe(0);
  });
});

describe("message_templates", () => {
  it("nasce ativo e aceita um template por tipo e tenant", async () => {
    const tenantId = await insertTenant("template");
    const id = await insertTemplate(tenantId);
    const { rows } = await client.query(`select active, variations from message_templates where id = $1`, [id]);
    expect(rows[0]).toEqual({ active: true, variations: VARIATIONS });
    expect(await pgErrorCode(insertTemplate(tenantId))).toBe(UNIQUE_VIOLATION);
    await insertTemplate(tenantId, "optout_confirmation");
    // Outro tenant tem o próprio template do mesmo tipo.
    await insertTemplate(await insertTenant("template-2"));
  });

  it("aceita só tipos da lista fechada (D16)", async () => {
    for (const messageType of ["campaign", "custom", ""]) {
      expect(await pgErrorCode(insertTemplate(a.tenantId, messageType))).toBe(CHECK_VIOLATION);
    }
  });

  it("exige 3 ou mais variações, sem nulo nem texto em branco (D5)", async () => {
    const tenantId = await insertTenant("variacoes");
    for (const variations of [
      null,
      [],
      ["Oi", "Olá"],
      ["Oi", "Olá", null],
      ["Oi", "", "Olá"],
      ["Oi", "Olá", "   "],
      ["\n\t", "Oi", "Olá"],
      [
        ["Oi", "Olá"],
        ["E aí", "Opa"],
      ],
    ]) {
      expect(await pgErrorCode(insertTemplate(tenantId, "appointment_confirmation", variations))).toBe(
        CHECK_VIOLATION,
      );
    }
    await insertTemplate(tenantId, "appointment_confirmation", ["Oi {{nome}}", " Olá ", "Linha 1\nLinha 2", "Quarta"]);
  });

  it("recusa tenant inexistente", async () => {
    expect(await pgErrorCode(insertTemplate(randomUUID()))).toBe(FK_VIOLATION);
  });
});

describe("colunas novas em whatsapp_connections e contacts", () => {
  function insertConnection(tenantId: string): Promise<string> {
    return insertReturningId(
      `insert into whatsapp_connections (id, tenant_id, session_id, updated_at) values (gen_random_uuid(), $1, $2, now())`,
      [tenantId, unique("sessao")],
    );
  }

  it("teto manual nasce nulo (D14), aceita valor positivo e recusa zero ou negativo", async () => {
    const id = await insertConnection(await insertTenant("teto"));
    const { rows } = await client.query(
      `select daily_send_limit, first_connected_at from whatsapp_connections where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ daily_send_limit: null, first_connected_at: null });
    await client.query(`update whatsapp_connections set daily_send_limit = 150 where id = $1`, [id]);
    for (const limit of [0, -1]) {
      expect(
        await pgErrorCode(client.query(`update whatsapp_connections set daily_send_limit = $1 where id = $2`, [limit, id])),
      ).toBe(CHECK_VIOLATION);
    }
    await client.query(`update whatsapp_connections set daily_send_limit = null where id = $1`, [id]);
  });

  it("guarda a data da primeira conexão", async () => {
    const id = await insertConnection(await insertTenant("primeira"));
    const at = new Date("2026-10-01T12:00:00.000Z");
    await client.query(`update whatsapp_connections set first_connected_at = $1 where id = $2`, [at, id]);
    const { rows } = await client.query(`select first_connected_at from whatsapp_connections where id = $1`, [id]);
    expect(rows[0].first_connected_at).toEqual(at);
  });

  it("contato nasce sem confirmação de opt-out enviada e guarda a data (D15)", async () => {
    const contactId = await insertContact(a.tenantId, "+5511900001111");
    const at = new Date("2026-10-02T09:30:00.000Z");
    const before = await client.query(`select opt_out_confirmation_sent_at from contacts where id = $1`, [contactId]);
    expect(before.rows[0].opt_out_confirmation_sent_at).toBeNull();
    await client.query(`update contacts set opt_out = true, opt_out_confirmation_sent_at = $1 where id = $2`, [
      at,
      contactId,
    ]);
    const after = await client.query(`select opt_out_confirmation_sent_at from contacts where id = $1`, [contactId]);
    expect(after.rows[0].opt_out_confirmation_sent_at).toEqual(at);
  });
});
