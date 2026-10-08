import "dotenv/config";
import { Client } from "pg";
import { E2E_EMAIL_DOMAIN, E2E_EMAIL_PREFIX } from "./accounts";

// Apaga da branch test os tenants e tentativas de login criados pelo E2E (cascata leva usuário
// e sessões). Só toca e-mails com o prefixo do E2E.
export default async function globalTeardown(): Promise<void> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const pattern = `${E2E_EMAIL_PREFIX}%${E2E_EMAIL_DOMAIN}`;
    const tenants = await client.query(
      "DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email LIKE $1)",
      [pattern],
    );
    const attempts = await client.query("DELETE FROM login_attempts WHERE email LIKE $1", [pattern]);
    console.log(`[e2e teardown] tenants apagados: ${tenants.rowCount}, tentativas apagadas: ${attempts.rowCount}`);
  } finally {
    await client.end();
  }
}
