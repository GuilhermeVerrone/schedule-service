import type { TenantRepository } from "@/server/repositories/tenant-repository";
import {
  MATURE_DAILY_LIMIT,
  tenantDay,
  usedToday,
  WARMUP_DAYS,
  WARMUP_STEPS,
  warmupLimit,
  warmupStatus,
} from "./send-policy";

// Uso do dia e fase do aquecimento do número (guia 3, 7f; D3, D6, D9, D14), para o painel. Só
// leitura: lê o contador gravado e aplica a mesma política do worker, sem recontar envios.

export interface SendUsage {
  // Sem conexão do WhatsApp cadastrada: nada foi enviado e o aquecimento ainda não começou.
  configured: boolean;
  // Dia do teto no fuso do tenant (YYYY-MM-DD).
  day: string;
  timezone: string;
  used: number;
  // Limite efetivo de hoje: curva do aquecimento, nunca acima do teto manual.
  limit: number;
  manualLimit: number | null;
  warmup: {
    startedAt: Date | null;
    day: number;
    totalDays: number;
    inWarmup: boolean;
    // Limite da curva hoje, antes do teto manual.
    curveLimit: number;
    matureLimit: number;
    // Próximo degrau da curva, ou null se já está no limite maduro.
    next: { day: number; limit: number } | null;
  };
}

export async function getSendUsage(repo: TenantRepository, now: Date = new Date()): Promise<SendUsage | null> {
  const state = await repo.sendCounter.getState();
  const timezone = state?.timezone ?? (await repo.settings.get())?.timezone;
  if (!timezone) return null;
  const firstConnectedAt = state?.firstConnectedAt ?? null;
  const manualLimit = state?.manualLimit ?? null;
  const day = tenantDay(now, timezone);
  const status = warmupStatus({ firstConnectedAt, manualLimit, now, timezone });
  const next = WARMUP_STEPS.find((step) => step.fromDay > status.day);
  return {
    configured: state !== null,
    day,
    timezone,
    used: state ? usedToday(state, day) : 0,
    limit: status.limit,
    manualLimit,
    warmup: {
      startedAt: firstConnectedAt,
      day: status.day,
      totalDays: WARMUP_DAYS,
      inWarmup: status.inWarmup,
      curveLimit: warmupLimit(status.day),
      matureLimit: MATURE_DAILY_LIMIT,
      next: next ? { day: next.fromDay, limit: next.limit } : null,
    },
  };
}
