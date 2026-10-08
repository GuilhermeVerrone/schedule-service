// Falha se algum código fora do repositório acessar o banco direto (guia 9, premissa f).
// Regras, aplicadas a src/ e scripts/ (testes ficam de fora: fixtures criam tenants direto):
//   1. `prisma.<modelo>` ou `prisma.$queryRaw`/`$executeRaw*`
//   2. importar o client (`@/lib/db`, `.../lib/db`) ou o PrismaClient gerado como valor
// Só src/server/repositories/ (e a infraestrutura listada em ALLOWED) pode fazer isso.
// Uso: pnpm check:tenant-access [raiz]
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface Violation {
  file: string;
  line: number;
  rule: "direct-model-access" | "raw-query" | "db-import";
  snippet: string;
}

const SCANNED_DIRS = ["src", "scripts"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Caminhos relativos à raiz, com "/" (prefixo de diretório ou arquivo exato).
const ALLOWED = [
  "src/server/repositories/",
  "src/generated/",
  "src/lib/db.ts",
  "scripts/check-db.ts", // health check de conexão (select current_database()), sem tabela de negócio
];

const RAW_METHODS = ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"];

export function modelAccessors(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    ([, name]) => name.charAt(0).toLowerCase() + name.slice(1),
  );
}

function isAllowed(file: string): boolean {
  return ALLOWED.some((allowed) => file === allowed || file.startsWith(allowed));
}

const escape = (value: string) => value.replace(/[$.]/g, "\\$&");

export function scanSource(file: string, content: string, models: readonly string[]): Violation[] {
  if (isAllowed(file)) return [];

  const modelAccess = new RegExp(`\\bprisma\\s*\\??\\.\\s*(${models.join("|")})\\b`);
  const rawQuery = new RegExp(`\\bprisma\\s*\\??\\.\\s*(${RAW_METHODS.map(escape).join("|")})`);
  const lines = content.split("\n");
  const violations: Violation[] = [];
  const at = (rule: Violation["rule"], line: number) =>
    violations.push({ file, line, rule, snippet: lines[line - 1].trim() });

  lines.forEach((text, index) => {
    if (/^\s*(\/\/|\/?\*)/.test(text)) return; // comentário
    if (modelAccess.test(text)) at("direct-model-access", index + 1);
    if (rawQuery.test(text)) at("raw-query", index + 1);
  });

  // Imports podem ocupar várias linhas: busca no arquivo inteiro.
  const imports = /\bimport\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of content.matchAll(imports)) {
    const specifier = match[2] ?? match[3];
    const clause = match[1] ?? "";
    const isDbClient = /(^|\/)lib\/db$/.test(specifier) || specifier === "@/lib/db";
    // Do client gerado, só tipos e o namespace Prisma (erros, enums) são liberados.
    const isGeneratedClient =
      /generated\/prisma/.test(specifier) && (match[3] !== undefined || /\bPrismaClient\b/.test(clause));
    if (isDbClient || isGeneratedClient) {
      at("db-import", content.slice(0, match.index).split("\n").length);
    }
  }
  return violations;
}

function listFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listFiles(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

export function checkTenantAccess(root: string, schemaPath = join(root, "prisma/schema.prisma")) {
  const models = modelAccessors(readFileSync(schemaPath, "utf8"));
  if (models.length === 0) throw new Error("Nenhum modelo encontrado no schema Prisma");

  return SCANNED_DIRS.flatMap((dir) => listFiles(join(root, dir))).flatMap((path) => {
    const file = relative(root, path).split(sep).join("/");
    return scanSource(file, readFileSync(path, "utf8"), models);
  });
}

function main(): void {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const root = process.argv[2] ?? projectRoot;
  const violations = checkTenantAccess(root, join(projectRoot, "prisma/schema.prisma"));
  if (violations.length === 0) {
    console.log("check-tenant-access: ok, nenhum acesso ao banco fora do repositório");
    return;
  }
  console.error(`check-tenant-access: ${violations.length} acesso(s) fora do repositório`);
  for (const v of violations) console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.snippet}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
