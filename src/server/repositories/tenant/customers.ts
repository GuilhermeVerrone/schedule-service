import { Prisma, type Customer } from "@/generated/prisma/client";
import {
  customerSchema,
  customerUpdateSchema,
  normalizedPhoneSchema,
  type CustomerInput,
} from "@/server/validation/agenda";
import { byId, type TenantScope } from "../shared";

// Clientes finais do tenant (D5), reencontrados pelo telefone normalizado.

export interface ConsentInput {
  // Origem do consentimento LGPD, ex.: "public_booking".
  source: string;
  at?: Date;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createCustomersRepository({ tenantId, db }: TenantScope) {
  return {
    list(): Promise<Customer[]> {
      return db.customer.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    },

    findById(id: string): Promise<Customer | null> {
      return byId(id, () => db.customer.findFirst({ where: { id, tenantId } }));
    },

    findByPhone(phone: string): Promise<Customer | null> {
      if (!normalizedPhoneSchema.safeParse(phone).success) return Promise.resolve(null);
      return db.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    },

    // Acha pelo telefone ou cria. Na corrida entre dois cadastros do mesmo telefone, a chave única
    // (tenant, telefone) recusa o segundo, que relê o primeiro. Cliente existente não tem nome nem
    // e-mail sobrescritos por quem só conhece o telefone; o consentimento é registrado uma vez,
    // na primeira vez em que é dado.
    async findOrCreateByPhone(input: CustomerInput, consent?: ConsentInput): Promise<Customer> {
      const data = customerSchema.parse(input);
      const consentData = consent
        ? { consentAt: consent.at ?? new Date(), consentSource: consent.source }
        : {};
      const where = { tenantId_phone: { tenantId, phone: data.phone } };
      let customer = await db.customer.findUnique({ where });
      if (!customer) {
        try {
          customer = await db.customer.create({
            data: { ...data, email: data.email ?? null, ...consentData, tenantId },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          customer = await db.customer.findUniqueOrThrow({ where });
        }
      }
      if (!consent || customer.consentAt) return customer;
      await db.customer.updateMany({
        where: { id: customer.id, tenantId, consentAt: null },
        data: consentData,
      });
      return db.customer.findFirstOrThrow({ where: { id: customer.id, tenantId } });
    },

    update(id: string, input: Partial<CustomerInput>): Promise<Customer | null> {
      const data = customerUpdateSchema.parse(input);
      return byId(id, () => db.customer.update({ where: { id, tenantId }, data }));
    },
  };
}
