import { Queue, type Job, type Processor } from "bullmq";
import type { Redis } from "ioredis";

// Fila de sistema do worker. Por enquanto só o job "ping", que prova de ponta a ponta que o
// worker conecta ao Redis e processa (Fase 1). A fila de envio entra na Fase 6.

export const SYSTEM_QUEUE = "system";
export const PING_JOB = "ping";

export type PingData = { requestedAt: string };
export type PingResult = { pong: true; requestedAt: string; processedAt: string };

export function createSystemQueue(connection: Redis): Queue<PingData, PingResult> {
  return new Queue<PingData, PingResult>(SYSTEM_QUEUE, {
    connection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  });
}

export const processSystemJob: Processor<PingData, PingResult> = async (job: Job<PingData, PingResult>) => {
  if (job.name !== PING_JOB) throw new Error(`job desconhecido na fila ${SYSTEM_QUEUE}`);
  return { pong: true, requestedAt: job.data.requestedAt, processedAt: new Date().toISOString() };
};
