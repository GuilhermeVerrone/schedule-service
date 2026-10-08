// Confere se o Prisma conecta nas branches dev e test do Neon.
// Uso: pnpm db:check. Não imprime connection strings.
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db";

const targets = [
  { branch: "dev", url: process.env.DATABASE_URL },
  { branch: "test", url: process.env.TEST_DATABASE_URL },
] as const;

async function check(branch: string, url: string | undefined): Promise<boolean> {
  if (!url) {
    console.error(`[${branch}] variável de conexão ausente`);
    return false;
  }
  const db = createPrismaClient(url);
  try {
    const [row] = await db.$queryRaw<{ db: string; host: string; version: string }[]>`
      select current_database() as db, inet_server_addr()::text as host, current_setting('server_version') as version
    `;
    const endpoint = new URL(url).hostname.split(".")[0];
    console.log(`[${branch}] ok: database=${row.db} endpoint=${endpoint} postgres=${row.version}`);
    return true;
  } catch (error) {
    console.error(`[${branch}] falhou: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<void> {
  const results = await Promise.all(targets.map((t) => check(t.branch, t.url)));
  if (results.includes(false)) process.exit(1);
}

void main();
