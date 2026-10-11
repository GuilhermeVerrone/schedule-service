import type { MessageTemplate, PrismaClient } from "@/generated/prisma/client";
import { OUTBOUND_MESSAGE_TYPES, type OutboundMessageType } from "@/server/outbound/message-types";
import {
  assertMessageType,
  DEFAULT_TEMPLATES,
  normalizeVariations,
  pickVariation,
} from "@/server/outbound/templates";
import { byId, isId, type TenantScope } from "../shared";

// Templates do tenant (guia 5; D5, D16): um por tipo da lista fechada. Tipo fora da lista lança
// UnknownMessageTypeError antes de chegar ao banco; variações inválidas lançam
// TemplateValidationError. Template de outro tenant (ou ID malformado) se comporta como inexistente.

export interface ChosenVariation {
  templateId: string;
  variant: number;
  text: string;
}

type TemplateDb = Pick<PrismaClient, "messageTemplate">;

// Cria os templates padrão que faltam; os existentes (talvez editados pelo dono) ficam como estão.
// Usado no cadastro do tenant (dentro da transação), no backfill e na leitura.
export async function createDefaultTemplates(db: TemplateDb, tenantId: string): Promise<number> {
  const { count } = await db.messageTemplate.createMany({
    data: OUTBOUND_MESSAGE_TYPES.map((messageType) => ({
      tenantId,
      messageType,
      variations: [...DEFAULT_TEMPLATES[messageType]],
    })),
    skipDuplicates: true,
  });
  return count;
}

export function createMessageTemplatesRepository({ tenantId, db }: TenantScope) {
  async function findByType(type: OutboundMessageType): Promise<MessageTemplate | null> {
    return db.messageTemplate.findUnique({ where: { tenantId_messageType: { tenantId, messageType: type } } });
  }

  // Tenant anterior a esta fase sem backfill ainda: o padrão nasce na primeira leitura.
  async function getOrCreate(type: OutboundMessageType): Promise<MessageTemplate> {
    const found = await findByType(type);
    if (found) return found;
    await createDefaultTemplates(db, tenantId);
    return db.messageTemplate.findUniqueOrThrow({
      where: { tenantId_messageType: { tenantId, messageType: type } },
    });
  }

  // Índice da variação usada no último envio desse tipo para o contato, ou null.
  async function lastVariantFor(contactId: string, type: unknown): Promise<number | null> {
    assertMessageType(type);
    if (!isId(contactId)) return null;
    const last = await db.outboundMessage.findFirst({
      where: { tenantId, contactId, messageType: type, templateVariant: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { templateVariant: true },
    });
    return last?.templateVariant ?? null;
  }

  return {
    ensureDefaults(): Promise<number> {
      return createDefaultTemplates(db, tenantId);
    },

    async list(): Promise<MessageTemplate[]> {
      await createDefaultTemplates(db, tenantId);
      const rows = await db.messageTemplate.findMany({ where: { tenantId } });
      const order = (row: MessageTemplate) => OUTBOUND_MESSAGE_TYPES.indexOf(row.messageType as OutboundMessageType);
      return rows.sort((a, b) => order(a) - order(b));
    },

    findById(id: string): Promise<MessageTemplate | null> {
      return byId(id, () => db.messageTemplate.findFirst({ where: { id, tenantId } }));
    },

    async getByType(type: unknown): Promise<MessageTemplate> {
      assertMessageType(type);
      return getOrCreate(type);
    },

    // Troca as variações de um template do tenant. O tipo não muda (lista fechada).
    async updateVariations(id: string, variations: readonly string[]): Promise<MessageTemplate | null> {
      if (!isId(id)) return null;
      const current = await db.messageTemplate.findFirst({ where: { id, tenantId }, select: { messageType: true } });
      if (!current) return null;
      const normalized = normalizeVariations(current.messageType, variations);
      return byId(id, () => db.messageTemplate.update({ where: { id, tenantId }, data: { variations: normalized } }));
    },

    async restoreDefault(type: unknown): Promise<MessageTemplate> {
      assertMessageType(type);
      return db.messageTemplate.upsert({
        where: { tenantId_messageType: { tenantId, messageType: type } },
        create: { tenantId, messageType: type, variations: [...DEFAULT_TEMPLATES[type]] },
        update: { variations: [...DEFAULT_TEMPLATES[type]] },
      });
    },

    lastVariantFor,

    // Variação ao acaso, sem repetir a última usada para o mesmo contato (D5).
    async chooseFor(contactId: string, type: unknown, random?: () => number): Promise<ChosenVariation> {
      assertMessageType(type);
      const [template, lastIndex] = await Promise.all([getOrCreate(type), lastVariantFor(contactId, type)]);
      const variant = pickVariation(template.variations.length, lastIndex, random);
      return { templateId: template.id, variant, text: template.variations[variant] };
    },
  };
}
