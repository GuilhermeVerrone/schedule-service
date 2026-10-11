import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Fronteira do adapter (guia 6, impacto "Arquitetura") e segredos (guia 9).
// 1. Nenhum código fora de src/server/whatsapp/ referencia o AKG: nem import do provider, nem
//    env AKG_*, nem o nome. O produto só conhece WhatsAppProvider.
// 2. Nenhum segredo versionado: .env fora do Git e .env.example só com nomes.

const root = fileURLToPath(new URL("..", import.meta.url));
const ADAPTER_DIR = "src/server/whatsapp/";
// Código do produto. src/generated/ é o client gerado do Prisma: repete os comentários do
// schema, onde "akg" é só o valor gravado em webhook_events.source.
const SCANNED_DIRS = ["src", "scripts"];
const IGNORED = ["src/generated/"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css)$/;

// "AKG", "Akg..." (AkgProvider) e "akg" fora de palavra (akg-provider, "akg", WA-AKG).
const AKG_REFERENCE = /AKG|Akg|(?<![A-Za-z])akg/;

const posix = (path: string) => path.split(sep).join("/");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function akgReferences(file: string, content: string): number[] {
  if (file.startsWith(ADAPTER_DIR) || IGNORED.some((dir) => file.startsWith(dir))) return [];
  return content
    .split("\n")
    .flatMap((line, index) => (AKG_REFERENCE.test(line) ? [index + 1] : []));
}

describe("fronteira do adapter do WhatsApp", () => {
  it("nenhum arquivo de src/ ou scripts/ fora de src/server/whatsapp/ referencia o AKG", () => {
    const files = SCANNED_DIRS.flatMap((dir) => listFiles(join(root, dir)))
      .map((path) => posix(relative(root, path)))
      .filter((file) => SOURCE_FILE.test(file));
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.startsWith(ADAPTER_DIR))).toBe(true);

    const violations = files.flatMap((file) =>
      akgReferences(file, readFileSync(join(root, file), "utf8")).map((line) => `${file}:${line}`),
    );
    expect(violations).toEqual([]);
  });

  it("o próprio adapter referencia o AKG (a varredura enxerga o que deveria)", () => {
    const content = readFileSync(join(root, ADAPTER_DIR, "akg-provider.ts"), "utf8");
    expect(AKG_REFERENCE.test(content)).toBe(true);
    expect(akgReferences(`${ADAPTER_DIR}akg-provider.ts`, content)).toEqual([]);
  });

  it.each([
    ['import { AkgProvider } from "@/server/whatsapp/akg-provider";', 1],
    ["const key = process.env.AKG_API_KEY;", 1],
    ['await fetch(`${process.env.AKG_BASE_URL}/sessions`);', 1],
    ['const source = "akg";', 1],
    ["// Integração com o WA-AKG", 1],
    ["const p = new AkgProvider(cfg);", 1],
  ])("detecta referência fora do adapter (falha de propósito): %s", (snippet, count) => {
    expect(akgReferences("src/app/api/webhooks/whatsapp/route.ts", `export {};\n${snippet}\n`)).toHaveLength(count);
  });

  it("palavras comuns não contam como referência", () => {
    const snippet = "background backgroundColor package packaged makeGrid breakgap Kakgo";
    expect(akgReferences("src/components/x.tsx", snippet)).toEqual([]);
  });

  it("o mesmo trecho dentro do adapter é permitido", () => {
    expect(akgReferences(`${ADAPTER_DIR}factory.ts`, 'import { AkgProvider } from "./akg-provider";')).toEqual([]);
  });
});

describe("segredos fora do repositório", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const SECRET_NAMES = [
    "AKG_API_KEY",
    "AKG_BASE_URL",
    "WHATSAPP_WEBHOOK_SECRET",
    "DATABASE_URL",
    "DIRECT_URL",
    "TEST_DATABASE_URL",
    "TEST_DIRECT_URL",
  ];
  // NOME=valor literal (linha de .env). Referência como `NOME=${...}` ou vazia não conta.
  const ASSIGNMENT = new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:${SECRET_NAMES.join("|")})[ \\t]*=[ \\t]*[^\\s$#]`, "m");
  // Connection string com usuário e senha.
  const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s:@/'"`]+:[^\s@/'"`]+@/;
  // Este arquivo tem os exemplos da checagem abaixo.
  const SELF = "tests/whatsapp-boundary.test.ts";
  const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pdf)$/i;

  it(".env não é versionado e está no .gitignore", () => {
    expect(git("ls-files", "--", ".env", ".env.local", ".env.test").trim()).toBe("");
    expect(git("check-ignore", ".env").trim()).toBe(".env");
  });

  it(".env.example tem os nomes novos do WhatsApp e nenhum valor", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const entries = example
      .split("\n")
      .filter((line) => /^\s*[A-Z_]+\s*=/.test(line))
      .map((line) => line.split("=").map((part) => part.trim()));
    const names = entries.map(([name]) => name);
    for (const name of ["AKG_BASE_URL", "AKG_API_KEY", "WHATSAPP_WEBHOOK_SECRET", "WHATSAPP_PROVIDER"]) {
      expect(names).toContain(name);
    }
    expect(entries.filter(([, value]) => value !== "")).toEqual([]);
  });

  it("nenhum arquivo versionado ou novo tem valor de segredo ou connection string com senha", () => {
    const files = [
      ...git("ls-files", "-z").split("\0"),
      ...git("ls-files", "-z", "--others", "--exclude-standard").split("\0"),
    ].filter((file) => file && file !== SELF && !BINARY.test(file));
    expect(files.length).toBeGreaterThan(100);

    const found = files.flatMap((file) => {
      let content: string;
      try {
        content = readFileSync(join(root, file), "utf8");
      } catch {
        return []; // removido no working tree
      }
      return ASSIGNMENT.test(content) || CONNECTION_STRING.test(content) ? [file] : [];
    });
    expect(found).toEqual([]);
  });

  it("a varredura de segredos detecta os casos (falha de propósito)", () => {
    expect(ASSIGNMENT.test("AKG_API_KEY=abc123")).toBe(true);
    expect(ASSIGNMENT.test("export WHATSAPP_WEBHOOK_SECRET='s3cr3t'")).toBe(true);
    expect(CONNECTION_STRING.test("postgresql://user:pass@ep-x.neon.tech/db")).toBe(true);
    expect(ASSIGNMENT.test("AKG_API_KEY=")).toBe(false);
    expect(ASSIGNMENT.test("AKG_API_KEY=\nWHATSAPP_PROVIDER=")).toBe(false);
    expect(ASSIGNMENT.test("DATABASE_URL=${TEST_DATABASE_URL}")).toBe(false);
    expect(CONNECTION_STRING.test("postgresql://localhost/db")).toBe(false);
  });
});
