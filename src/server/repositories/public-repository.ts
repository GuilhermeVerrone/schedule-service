import type { PrismaClient, Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isReservedSlug } from "@/server/auth/reserved-slugs";
import { SLUG_MAX_LENGTH } from "@/server/auth/slug";

// Única leitura sem sessão (D1, guia 6): o tenant vem só do slug da URL, nunca de um tenantId
// enviado pelo cliente. Devolve só campos públicos: dados do negócio, parâmetros da agenda e
// serviços e profissionais ativos (não arquivados) que tenham vínculo ativo entre si.
// Para gravar (agendar), quem chama monta createTenantRepository(tenantId) com o tenantId
// resolvido aqui, que é de uso interno do servidor e não vai para a resposta.

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const businessFields = {
  slug: true,
  name: true,
  description: true,
  address: true,
  phone: true,
  timezone: true,
  slotStepMinutes: true,
  bufferMinutes: true,
  minAdvanceMinutes: true,
  maxWindowDays: true,
  cancelDeadlineMinutes: true,
} as const;

export type PublicBusiness = Pick<Tenant, keyof typeof businessFields>;

export interface ResolvedTenant {
  // Interno: monta o repositório do tenant. Nunca serializar.
  tenantId: string;
  business: PublicBusiness;
}

export interface PublicService {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  professionalIds: string[];
}

export interface PublicProfessional {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface PublicSite extends ResolvedTenant {
  services: PublicService[];
  professionals: PublicProfessional[];
}

export function isPublicSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}

export function createPublicRepository(db: PrismaClient = prisma) {
  async function resolveTenant(slug: string): Promise<ResolvedTenant | null> {
    if (!isPublicSlug(slug)) return null;
    const tenant = await db.tenant.findUnique({
      where: { slug },
      select: { id: true, ...businessFields },
    });
    if (!tenant) return null;
    const { id, ...business } = tenant;
    return { tenantId: id, business };
  }

  return {
    resolveTenant,

    async getSite(slug: string): Promise<PublicSite | null> {
      const resolved = await resolveTenant(slug);
      if (!resolved) return null;
      const { tenantId } = resolved;

      // Vínculo só conta se as duas pontas estiverem ativas e no mesmo tenant.
      const [services, professionals] = await Promise.all([
        db.service.findMany({
          where: { tenantId, archivedAt: null },
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            priceCents: true,
            professionals: {
              where: { tenantId, professional: { tenantId, archivedAt: null } },
              select: { professionalId: true },
              orderBy: { professionalId: "asc" },
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        db.professional.findMany({
          where: { tenantId, archivedAt: null },
          select: {
            id: true,
            name: true,
            services: {
              where: { tenantId, service: { tenantId, archivedAt: null } },
              select: { serviceId: true },
              orderBy: { serviceId: "asc" },
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
      ]);

      return {
        ...resolved,
        services: services
          .map(({ professionals: links, ...service }) => ({
            ...service,
            professionalIds: links.map((link) => link.professionalId),
          }))
          .filter((service) => service.professionalIds.length > 0),
        professionals: professionals
          .map(({ services: links, ...professional }) => ({
            ...professional,
            serviceIds: links.map((link) => link.serviceId),
          }))
          .filter((professional) => professional.serviceIds.length > 0),
      };
    },
  };
}

export type PublicRepository = ReturnType<typeof createPublicRepository>;
