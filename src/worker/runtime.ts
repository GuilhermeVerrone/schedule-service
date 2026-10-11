import { writeFile } from "node:fs/promises";
import { QueueEvents, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { createProducerConnection, createWorkerConnection, redisUrl } from "@/server/queue/connection";
import {
  createSystemQueue,
  PING_JOB,
  processSystemJob,
  SYSTEM_QUEUE,
  type PingData,
  type PingResult,
} from "@/server/queue/system-queue";
import { HEARTBEAT_FILE, HEARTBEAT_INTERVAL_MS } from "./heartbeat";

// Núcleo do worker (D2): processo separado, mesma imagem do app, sem nada do Next (headers,
// cookies, sessão). Tudo que precisa vem do ambiente e do payload do job.

export type WorkerLog = (event: string, fields?: Record<string, unknown>) => void;

// Log estruturado de uma linha. Nunca recebe URL, senha, telefone nem texto de mensagem.
export const jsonLog: WorkerLog = (event, fields = {}) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), service: "worker", event, ...fields }));
};

export type WorkerHandle = {
  worker: Worker<PingData, PingResult>;
  // Worker rodando e Redis respondendo ao PING.
  isHealthy: () => Promise<boolean>;
  close: () => Promise<void>;
};

export async function startWorker(url: string = redisUrl(), log: WorkerLog = jsonLog): Promise<WorkerHandle> {
  const connection = createWorkerConnection(url);
  connection.on("error", (error) => log("redis_error", { error: error.name }));
  const worker = new Worker<PingData, PingResult>(SYSTEM_QUEUE, processSystemJob, { connection });
  worker.on("completed", (job) => log("job_completed", { queue: SYSTEM_QUEUE, job: job.name, id: job.id }));
  worker.on("failed", (job, error) =>
    log("job_failed", { queue: SYSTEM_QUEUE, job: job?.name, id: job?.id, error: error.message }),
  );
  await worker.waitUntilReady();
  log("worker_ready", { queues: [SYSTEM_QUEUE] });

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      await worker.close();
      await connection.quit().catch(() => connection.disconnect());
      log("worker_closed");
    })();
    return closing;
  };
  // Com o Redis fora do ar o PING desta conexão espera (maxRetriesPerRequest nulo): o prazo evita
  // checagens acumuladas e o batimento simplesmente para.
  const isHealthy = async () => {
    if (!worker.isRunning()) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), 2_000)));
    const pong = connection.ping().then((reply) => reply === "PONG", () => false);
    return Promise.race([pong, timeout]).finally(() => clearTimeout(timer));
  };
  return { worker, isHealthy, close };
}

// Enfileira um ping e espera o resultado: usado pelo smoke test e pelos testes de integração.
export async function runPing(url: string = redisUrl(), timeoutMs = 10_000): Promise<PingResult> {
  const producer: Redis = createProducerConnection(url);
  const eventsConnection = createWorkerConnection(url);
  const queue = createSystemQueue(producer);
  const events = new QueueEvents(SYSTEM_QUEUE, { connection: eventsConnection });
  try {
    await Promise.all([events.waitUntilReady(), queue.waitUntilReady()]);
    const job = await queue.add(PING_JOB, { requestedAt: new Date().toISOString() });
    return await job.waitUntilFinished(events, timeoutMs);
  } finally {
    await events.close();
    await queue.close();
    await Promise.all([producer, eventsConnection].map((c) => c.quit().catch(() => c.disconnect())));
  }
}

// Grava o batimento (src/worker/heartbeat.ts) só quando o worker está saudável.
export function startHeartbeat(isHealthy: () => Promise<boolean>): () => void {
  const beat = async () => {
    if (await isHealthy()) await writeFile(HEARTBEAT_FILE, String(Date.now()));
  };
  void beat().catch(() => {});
  const timer = setInterval(() => void beat().catch(() => {}), HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
