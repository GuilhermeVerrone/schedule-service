// Aplica as migrações na branch test do Neon antes da suíte (nunca na dev).
import { execFileSync } from "node:child_process";

export default function setup(): void {
  const directUrl = process.env.TEST_DIRECT_URL;
  if (!directUrl) throw new Error("TEST_DIRECT_URL não definida (branch test do Neon)");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DIRECT_URL: directUrl },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
