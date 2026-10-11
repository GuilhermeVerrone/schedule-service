import { byId, type TenantScope } from "../shared";

// Fatos de um contato para a regra de envio proativo (guia 6; D13). Lê só o que a regra usa,
// sempre com o tenantId embutido: contato de outro tenant (ou ID malformado) volta null.

export interface EligibilityFacts {
  optOut: boolean;
  lastInboundAt: Date | null;
  consentAt: Date | null;
  // Agendamento `confirmed` conta como ativo (D13); cancelado e concluído não.
  hasConfirmedAppointment: boolean;
  // Planos e cobranças ainda não existem no schema (Fatias 6 e 7): ficam false até lá.
  hasActivePlan: boolean;
  hasActiveCharge: boolean;
}

// Fatos da confirmação única de opt-out (D15).
export interface OptOutConfirmationFacts {
  optOut: boolean;
  lastInboundAt: Date | null;
  optOutConfirmationSentAt: Date | null;
}

export function createEligibilityRepository({ tenantId, db }: TenantScope) {
  return {
    findFacts(contactId: string): Promise<EligibilityFacts | null> {
      return byId(contactId, async () => {
        const contact = await db.contact.findFirst({
          where: { id: contactId, tenantId },
          select: {
            optOut: true,
            lastInboundAt: true,
            consentAt: true,
            appointments: { where: { tenantId, status: "confirmed" }, select: { id: true }, take: 1 },
          },
        });
        if (!contact) return null;
        return {
          optOut: contact.optOut,
          lastInboundAt: contact.lastInboundAt,
          consentAt: contact.consentAt,
          hasConfirmedAppointment: contact.appointments.length > 0,
          hasActivePlan: false,
          hasActiveCharge: false,
        };
      });
    },

    findOptOutConfirmationFacts(contactId: string): Promise<OptOutConfirmationFacts | null> {
      return byId(contactId, () =>
        db.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { optOut: true, lastInboundAt: true, optOutConfirmationSentAt: true },
        }),
      );
    },
  };
}
