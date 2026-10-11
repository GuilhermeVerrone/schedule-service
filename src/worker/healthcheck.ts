import { readFileSync } from "node:fs";
import { HEARTBEAT_FILE, HEARTBEAT_MAX_AGE_MS } from "./heartbeat";

// Healthcheck do contêiner do worker (docker-compose.yml): saudável se o batimento é recente,
// ou seja, o worker está rodando e o Redis respondeu ao PING há pouco.
try {
  const age = Date.now() - Number(readFileSync(HEARTBEAT_FILE, "utf8"));
  process.exit(age >= 0 && age <= HEARTBEAT_MAX_AGE_MS ? 0 : 1);
} catch {
  process.exit(1);
}
