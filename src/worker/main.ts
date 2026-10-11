import "dotenv/config";
import { HEARTBEAT_FILE } from "./heartbeat";
import { jsonLog, runPing, startHeartbeat, startWorker } from "./runtime";

// Entrada do worker (D2): `pnpm worker`. Processo separado do Next, mesma imagem do app.
// `pnpm worker:smoke` (--smoke): sobe o worker, processa um job de teste e encerra limpo.
// SIGTERM/SIGINT (docker compose stop): termina o job em andamento, fecha as conexões e sai com 0.

async function main(): Promise<void> {
  const smoke = process.argv.includes("--smoke");
  const handle = await startWorker();

  if (smoke) {
    const result = await runPing();
    jsonLog("smoke_ok", { pong: result.pong });
    await handle.close();
    return;
  }

  const stopHeartbeat = startHeartbeat(handle.isHealthy);
  jsonLog("heartbeat_started", { file: HEARTBEAT_FILE });
  const shutdown = (signal: NodeJS.Signals) => {
    jsonLog("shutdown", { signal });
    stopHeartbeat();
    handle.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  jsonLog("worker_failed", { error: error instanceof Error ? error.message : "erro desconhecido" });
  process.exit(1);
});
