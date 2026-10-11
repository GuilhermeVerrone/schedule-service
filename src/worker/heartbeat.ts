// Batimento para o healthcheck do Compose: o worker grava a hora a cada intervalo enquanto está
// rodando e o Redis responde; src/worker/healthcheck.ts confere se o arquivo é recente.
export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/slotz-worker-heartbeat";
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MAX_AGE_MS = HEARTBEAT_INTERVAL_MS * 3;
