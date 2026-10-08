import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("conexão com o banco", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("usa a branch test do Neon", () => {
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
  });

  it("responde a uma query pelo Prisma", async () => {
    const rows = await prisma.$queryRaw<{ db: string; ok: number }[]>`
      select current_database() as db, 1::int as ok
    `;
    expect(rows).toEqual([{ db: "slotz", ok: 1 }]);
  });
});
