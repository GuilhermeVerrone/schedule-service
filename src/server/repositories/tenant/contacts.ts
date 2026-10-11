import { Prisma, type Contact } from "@/generated/prisma/client";
import {
  contactSchema,
  contactUpdateSchema,
  normalizedPhoneSchema,
  type ContactInput,
} from "@/server/validation/agenda";
import { byId, type TenantScope } from "../shared";

// Contatos do tenant (D1 da Fatia 3): clientes finais, reencontrados pelo telefone em E.164.

export interface ConsentInput {
  // Origem do consentimento LGPD, ex.: "public_booking".
  source: string;
  at?: Date;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createContactsRepository({ tenantId, db }: TenantScope) {
  return {
    list(): Promise<Contact[]> {
      return db.contact.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    },

    findById(id: string): Promise<Contact | null> {
      return byId(id, () => db.contact.findFirst({ where: { id, tenantId } }));
    },

    findByPhone(phone: string): Promise<Contact | null> {
      if (!normalizedPhoneSchema.safeParse(phone).success) return Promise.resolve(null);
      return db.contact.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    },

    // Acha pelo telefone ou cria. Na corrida entre dois cadastros do mesmo telefone, a chave única
    // (tenant, telefone) recusa o segundo, que relê o primeiro. Contato existente não tem nome nem
    // e-mail sobrescritos por quem só conhece o telefone; o consentimento é registrado uma vez,
    // na primeira vez em que é dado.
    async findOrCreateByPhone(input: ContactInput, consent?: ConsentInput): Promise<Contact> {
      const data = contactSchema.parse(input);
      const consentData = consent
        ? { consentAt: consent.at ?? new Date(), consentSource: consent.source }
        : {};
      const where = { tenantId_phone: { tenantId, phone: data.phone } };
      let contact = await db.contact.findUnique({ where });
      if (!contact) {
        try {
          contact = await db.contact.create({
            data: { ...data, email: data.email ?? null, ...consentData, tenantId },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          contact = await db.contact.findUniqueOrThrow({ where });
        }
      }
      if (!consent || contact.consentAt) return contact;
      await db.contact.updateMany({
        where: { id: contact.id, tenantId, consentAt: null },
        data: consentData,
      });
      return db.contact.findFirstOrThrow({ where: { id: contact.id, tenantId } });
    },

    update(id: string, input: Partial<ContactInput>): Promise<Contact | null> {
      const data = contactUpdateSchema.parse(input);
      return byId(id, () => db.contact.update({ where: { id, tenantId }, data }));
    },
  };
}
