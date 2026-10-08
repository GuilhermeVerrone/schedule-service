import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkTenantAccess, scanSource } from "../scripts/check-tenant-access";

const root = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(root, "prisma/schema.prisma");
const MODELS = [
  "tenant",
  "user",
  "session",
  "loginAttempt",
  "professional",
  "service",
  "professionalService",
  "workingHours",
];

describe("checagem de acesso ao banco fora do repositório", () => {
  it("o código atual do projeto passa", () => {
    expect(checkTenantAccess(root)).toEqual([]);
  });

  it("detecta prisma.<modelo> fora do repositório (falha de propósito)", () => {
    const violations = scanSource(
      "src/app/api/professionals/route.ts",
      `export async function GET() {\n  return prisma.professional.findMany();\n}\n`,
      MODELS,
    );
    expect(violations).toEqual([
      expect.objectContaining({ line: 2, rule: "direct-model-access" }),
    ]);
  });

  it("detecta cada modelo do schema, raw query e import do client", () => {
    for (const model of MODELS) {
      expect(scanSource("src/x.ts", `await prisma.${model}.count()`, MODELS)).toHaveLength(1);
    }
    expect(scanSource("src/x.ts", "await prisma.$queryRawUnsafe(sql)", MODELS)[0].rule).toBe("raw-query");
    expect(scanSource("src/x.ts", 'import { prisma as db } from "@/lib/db";', MODELS)[0].rule).toBe("db-import");
    expect(scanSource("src/x.ts", 'import {\n  prisma,\n} from "../lib/db";', MODELS)[0]).toMatchObject({
      rule: "db-import",
      line: 1,
    });
    expect(
      scanSource("src/x.ts", 'import { PrismaClient } from "@/generated/prisma/client";', MODELS),
    ).toHaveLength(1);
  });

  it("libera o repositório, tipos gerados e comentários", () => {
    expect(
      scanSource("src/server/repositories/foo.ts", "await prisma.session.findMany()", MODELS),
    ).toEqual([]);
    expect(
      scanSource("src/ui.tsx", 'import type { Professional } from "@/generated/prisma/client";', MODELS),
    ).toEqual([]);
    expect(scanSource("src/x.ts", "// nunca use prisma.service aqui", MODELS)).toEqual([]);
    // O repositório expõe grupos com nomes próprios: não confundir com o client.
    expect(scanSource("src/x.ts", "await repo.workingHours.list(id)", MODELS)).toEqual([]);
  });

  describe("CLI ponta a ponta numa árvore com violação", () => {
    const tree = mkdtempSync(join(tmpdir(), "slotz-check-"));
    afterAll(() => rmSync(tree, { recursive: true, force: true }));

    it("sai com código 1 e aponta o arquivo", () => {
      const file = join(tree, "src/app/painel/page.tsx");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "const rows = await prisma.service.findMany();\n");

      let status = 0;
      let stderr = "";
      try {
        execFileSync("pnpm", ["exec", "tsx", join(root, "scripts/check-tenant-access.ts"), tree], {
          cwd: root,
          stdio: "pipe",
        });
      } catch (error) {
        const failure = error as { status: number; stderr: Buffer };
        status = failure.status;
        stderr = failure.stderr.toString();
      }
      expect(status).toBe(1);
      expect(stderr).toContain("src/app/painel/page.tsx:1 [direct-model-access]");
      expect(checkTenantAccess(tree, schemaPath)).toHaveLength(1);
    });
  });
});
