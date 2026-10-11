import type { EligibilityFacts, TenantRepository } from "@/server/repositories/tenant-repository";

// Elegibilidade para mensagem proativa (regra inegociável do produto; guia 6; D13). Elegível se
// (a) escreveu nos últimos 30 dias, OU (b) tem agendamento `confirmed`, plano ou cobrança ativa,
// OU (c) tem consentimento registrado. `opt_out` vence qualquer regra. O motivo vira o
// `block_reason` do envio bloqueado (formato `^[a-z][a-z0-9_]*$`).

export const RECENT_INBOUND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type EligibleReason = "recent_inbound" | "active_commitment" | "registered_consent";
export type IneligibleReason = "opt_out" | "not_eligible" | "contact_not_found";

export type Eligibility =
  | { eligible: true; reason: EligibleReason }
  | { eligible: false; reason: IneligibleReason };

// Regra pura, sem banco. Fronteira inclusiva: exatamente 30 dias depois ainda é elegível.
export function evaluateEligibility(facts: EligibilityFacts | null, now: Date): Eligibility {
  if (!facts) return { eligible: false, reason: "contact_not_found" };
  if (facts.optOut) return { eligible: false, reason: "opt_out" };
  if (facts.lastInboundAt && now.getTime() - facts.lastInboundAt.getTime() <= RECENT_INBOUND_WINDOW_MS) {
    return { eligible: true, reason: "recent_inbound" };
  }
  if (facts.hasConfirmedAppointment || facts.hasActivePlan || facts.hasActiveCharge) {
    return { eligible: true, reason: "active_commitment" };
  }
  if (facts.consentAt) return { eligible: true, reason: "registered_consent" };
  return { eligible: false, reason: "not_eligible" };
}

// Lê os fatos pelo repositório do tenant: contato de outro tenant nunca é considerado.
export async function isContactEligibleForProactive(
  repo: Pick<TenantRepository, "eligibility">,
  contactId: string,
  now: Date = new Date(),
): Promise<Eligibility> {
  return evaluateEligibility(await repo.eligibility.findFacts(contactId), now);
}
