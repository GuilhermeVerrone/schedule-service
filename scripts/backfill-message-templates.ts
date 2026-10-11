// Cria os templates padrão (D5) que faltam nos tenants existentes. Idempotente.
// Uso: pnpm templates:backfill [dev|test] (padrão: dev). Não imprime connection strings.
import "dotenv/config";
import { backfillDefaultTemplatesAt } from "../src/server/repositories/message-templates-backfill";

const branch = process.argv[2] ?? "dev";
const urls: Record<string, string | undefined> = {
  dev: process.env.DATABASE_URL,
  test: process.env.TEST_DATABASE_URL,
};

async function main(): Promise<void> {
  const url = urls[branch];
  if (!url) {
    console.error(`[${branch}] branch desconhecida ou variável de conexão ausente`);
    process.exit(1);
  }
  const result = await backfillDefaultTemplatesAt(url);
  console.log(`[${branch}] ok: tenants=${result.tenants} templates criados=${result.created}`);
}

main().catch((error: unknown) => {
  console.error(`[${branch}] falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
