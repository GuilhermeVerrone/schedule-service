import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "@/server/auth/reserved-slugs";

// Restrições da agenda direto no SQL (D4, D8), contornando repositório e Prisma: o banco tem de
// recusar sozinho o que o código deixar passar. Roda na branch test (DATABASE_URL do Vitest).

const EXCLUSION_VIOLATION = "23P01";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

let client: pg.Client;
const tenantIds: string[] = [];

interface Fixture {
  tenantId: string;
  professionalA: string;
  professionalB: string;
  serviceId: string;
  customerId: string;
}

let a: Fixture;
let b: Fixture;

async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`${sql} returning id`, params);
  return rows[0].id;
}

async function createFixture(label: string): Promise<Fixture> {
  const tenantId = await insertReturningId(
    `insert into tenants (id, name, slug, updated_at) values (gen_random_uuid(), $1, $2, now())`,
    [`Teste ${label}`, `teste-agenda-${label}-${randomUUID().slice(0, 8)}`],
  );
  tenantIds.push(tenantId);
  const professional = (name: string) =>
    insertReturningId(
      `insert into professionals (id, tenant_id, name, updated_at) values (gen_random_uuid(), $1, $2, now())`,
      [tenantId, name],
    );
  return {
    tenantId,
    professionalA: await professional("Ana"),
    professionalB: await professional("Bia"),
    serviceId: await insertReturningId(
      `insert into services (id, tenant_id, name, duration_minutes, price_cents, updated_at)
       values (gen_random_uuid(), $1, 'Corte', 60, 5000, now())`,
      [tenantId],
    ),
    customerId: await insertReturningId(
      `insert into customers (id, tenant_id, name, phone, updated_at) values (gen_random_uuid(), $1, 'Cliente', $2, now())`,
      [tenantId, "5511987654321"],
    ),
  };
}

interface NewAppointment {
  tenantId?: string;
  professionalId?: string;
  customerId?: string;
  start: string;
  end: string;
  status?: "confirmed" | "canceled" | "completed";
}

function insertAppointment(f: Fixture, input: NewAppointment): Promise<string> {
  return insertReturningId(
    `insert into appointments (id, tenant_id, professional_id, service_id, customer_id, starts_at, ends_at, status, updated_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::appointment_status, now())`,
    [
      input.tenantId ?? f.tenantId,
      input.professionalId ?? f.professionalA,
      f.serviceId,
      input.customerId ?? f.customerId,
      input.start,
      input.end,
      input.status ?? "confirmed",
    ],
  );
}

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

// Dias distintos por teste: um teste não esbarra nos agendamentos do outro.
const at = (day: number, time: string) => `2030-01-${String(day).padStart(2, "0")}T${time}:00Z`;

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

describe("appointments_no_overlap (EXCLUDE gist, só confirmed)", () => {
  it("recusa sobreposição confirmed do mesmo profissional", async () => {
    await insertAppointment(a, { start: at(1, "10:00"), end: at(1, "11:00") });
    expect(await pgErrorCode(insertAppointment(a, { start: at(1, "10:30"), end: at(1, "11:30") }))).toBe(
      EXCLUSION_VIOLATION,
    );
    // Contido no outro também é sobreposição.
    expect(await pgErrorCode(insertAppointment(a, { start: at(1, "10:15"), end: at(1, "10:45") }))).toBe(
      EXCLUSION_VIOLATION,
    );
  });

  it("aceita canceled sobreposto", async () => {
    await insertAppointment(a, { start: at(2, "10:00"), end: at(2, "11:00") });
    await expect(
      insertAppointment(a, { start: at(2, "10:00"), end: at(2, "11:00"), status: "canceled" }),
    ).resolves.toEqual(expect.any(String));
  });

  it("aceita profissionais diferentes no mesmo horário", async () => {
    await insertAppointment(a, { start: at(3, "10:00"), end: at(3, "11:00") });
    await expect(
      insertAppointment(a, { professionalId: a.professionalB, start: at(3, "10:00"), end: at(3, "11:00") }),
    ).resolves.toEqual(expect.any(String));
  });

  it("aceita intervalos que só se encostam e completed sobreposto", async () => {
    await insertAppointment(a, { start: at(4, "10:00"), end: at(4, "11:00") });
    await expect(insertAppointment(a, { start: at(4, "11:00"), end: at(4, "12:00") })).resolves.toBeTruthy();
    await expect(
      insertAppointment(a, { start: at(4, "10:30"), end: at(4, "11:30"), status: "completed" }),
    ).resolves.toBeTruthy();
  });

  it("reconfirmar um cancelado que agora colide é recusado", async () => {
    await insertAppointment(a, { start: at(5, "10:00"), end: at(5, "11:00") });
    const canceled = await insertAppointment(a, { start: at(5, "10:30"), end: at(5, "11:30"), status: "canceled" });
    const code = await pgErrorCode(
      client.query(`update appointments set status = 'confirmed' where id = $1`, [canceled]),
    );
    expect(code).toBe(EXCLUSION_VIOLATION);
  });

  it("concorrência: dois inserts simultâneos no mesmo horário, só um vence", async () => {
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      const params = [a.tenantId, a.professionalA, a.serviceId, a.customerId, at(6, "10:00"), at(6, "11:00")];
      const sql = `insert into appointments (id, tenant_id, professional_id, service_id, customer_id, starts_at, ends_at, updated_at)
                   values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())`;
      const results = await Promise.allSettled([client.query(sql, params), other.query(sql, params)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((rejected.reason as { code?: string }).code).toBe(EXCLUSION_VIOLATION);
    } finally {
      await other.end();
    }
  });
});

describe("integridade dos agendamentos e bloqueios", () => {
  it("FK composta: não aponta para profissional ou cliente de outro tenant", async () => {
    expect(
      await pgErrorCode(insertAppointment(a, { professionalId: b.professionalA, start: at(7, "10:00"), end: at(7, "11:00") })),
    ).toBe(FK_VIOLATION);
    expect(
      await pgErrorCode(insertAppointment(a, { customerId: b.customerId, start: at(7, "12:00"), end: at(7, "13:00") })),
    ).toBe(FK_VIOLATION);
    expect(
      await pgErrorCode(
        client.query(
          `insert into time_blocks (id, tenant_id, professional_id, starts_at, ends_at, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, now())`,
          [a.tenantId, b.professionalA, at(7, "14:00"), at(7, "15:00")],
        ),
      ),
    ).toBe(FK_VIOLATION);
  });

  it("fim precisa ser depois do início (agendamento e bloqueio)", async () => {
    expect(await pgErrorCode(insertAppointment(a, { start: at(8, "10:00"), end: at(8, "10:00") }))).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await pgErrorCode(
        client.query(
          `insert into time_blocks (id, tenant_id, professional_id, starts_at, ends_at, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, now())`,
          [a.tenantId, a.professionalA, at(8, "12:00"), at(8, "11:00")],
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("histórico sobrevive: profissional com agendamento não pode ser apagado", async () => {
    const professional = await insertReturningId(
      `insert into professionals (id, tenant_id, name, updated_at) values (gen_random_uuid(), $1, 'Cris', now())`,
      [a.tenantId],
    );
    await insertAppointment(a, { professionalId: professional, start: at(9, "10:00"), end: at(9, "11:00") });
    expect(await pgErrorCode(client.query(`delete from professionals where id = $1`, [professional]))).toBe(
      FK_VIOLATION,
    );
  });

  it("apagar o tenant leva agendamentos, clientes e bloqueios em cascata", async () => {
    const f = await createFixture("cascata");
    await insertAppointment(f, { start: at(10, "10:00"), end: at(10, "11:00") });
    await client.query(
      `insert into time_blocks (id, tenant_id, professional_id, starts_at, ends_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, $4, now())`,
      [f.tenantId, f.professionalA, at(10, "12:00"), at(10, "13:00")],
    );
    await client.query(`delete from tenants where id = $1`, [f.tenantId]);
    const { rows } = await client.query<{ total: number }>(
      `select (select count(*) from appointments where tenant_id = $1)
            + (select count(*) from customers where tenant_id = $1)
            + (select count(*) from time_blocks where tenant_id = $1) as total`,
      [f.tenantId],
    );
    expect(Number(rows[0].total)).toBe(0);
  });

  it("token de gestão: hash único", async () => {
    const hash = randomUUID();
    const first = await insertAppointment(a, { start: at(11, "10:00"), end: at(11, "11:00") });
    const second = await insertAppointment(a, { start: at(11, "12:00"), end: at(11, "13:00") });
    await client.query(`update appointments set manage_token_hash = $1 where id = $2`, [hash, first]);
    expect(
      await pgErrorCode(client.query(`update appointments set manage_token_hash = $1 where id = $2`, [hash, second])),
    ).toBe("23505");
  });
});

describe("cliente e parâmetros do tenant", () => {
  it("telefone do cliente só com dígitos e DDI 55; único por tenant", async () => {
    const insert = (tenantId: string, phone: string) =>
      client.query(
        `insert into customers (id, tenant_id, name, phone, updated_at) values (gen_random_uuid(), $1, 'X', $2, now())`,
        [tenantId, phone],
      );
    expect(await pgErrorCode(insert(a.tenantId, "11987654321"))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insert(a.tenantId, "+5511987654321"))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insert(a.tenantId, "5511987654321"))).toBe("23505");
    // O mesmo telefone em outro negócio é outro cliente.
    await expect(insert(b.tenantId, "5521987654321")).resolves.toBeTruthy();
  });

  it("parâmetros da agenda nascem com os padrões (D3)", async () => {
    const { rows } = await client.query(
      `select slot_step_minutes, buffer_minutes, min_advance_minutes, max_window_days, cancel_deadline_minutes,
              description, address, phone
         from tenants where id = $1`,
      [a.tenantId],
    );
    expect(rows[0]).toEqual({
      slot_step_minutes: 15,
      buffer_minutes: 0,
      min_advance_minutes: 120,
      max_window_days: 60,
      cancel_deadline_minutes: 120,
      description: null,
      address: null,
      phone: null,
    });
  });

  it.each([
    ["slot_step_minutes", 7],
    ["slot_step_minutes", 0],
    ["buffer_minutes", -5],
    ["buffer_minutes", 3],
    ["min_advance_minutes", -1],
    ["max_window_days", 0],
    ["max_window_days", 366],
    ["cancel_deadline_minutes", -1],
  ])("CHECK recusa %s = %i", async (column, value) => {
    expect(await pgErrorCode(client.query(`update tenants set ${column} = $1 where id = $2`, [value, a.tenantId]))).toBe(
      CHECK_VIOLATION,
    );
  });
});

describe("slugs reservados na migração", () => {
  it("a migração renomeia exatamente a lista de src/server/auth/reserved-slugs.ts", () => {
    const dir = join(process.cwd(), "prisma/migrations");
    const migration = readdirSync(dir).find((name) => name.endsWith("_agenda_link_publico"));
    expect(migration).toBeDefined();
    const sql = readFileSync(join(dir, migration!, "migration.sql"), "utf8");
    const array = sql.match(/reserved TEXT\[\] := ARRAY\[([^\]]*)\]/);
    expect(array).not.toBeNull();
    const listed = [...array![1].matchAll(/'([^']+)'/g)].map(([, slug]) => slug);
    expect([...listed].sort()).toEqual([...RESERVED_SLUGS].sort());
  });
});
