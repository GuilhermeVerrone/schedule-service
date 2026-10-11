import type { AppointmentStatus, Prisma } from "@/generated/prisma/client";
import { dateRangeSchema, type DateRange } from "@/server/validation/agenda";
import {
  contactExists,
  isConstraintViolation,
  isId,
  professionalExists,
  serviceExists,
  type TenantScope,
} from "../shared";

// Agendamentos (D4, D8). Só `confirmed` ocupa horário; a sobreposição do mesmo profissional é
// barrada pela EXCLUDE gist do banco, inclusive na corrida entre duas gravações, e chega aqui
// como AppointmentConflictError (a API responde 409).

export class AppointmentConflictError extends Error {
  constructor() {
    super("O profissional já tem agendamento nesse horário");
    this.name = "AppointmentConflictError";
  }
}

// Transição de status inválida (ex.: remarcar um cancelado, concluir um cancelado).
export class AppointmentStatusError extends Error {
  constructor(readonly status: AppointmentStatus) {
    super(`Agendamento com status ${status} não aceita essa operação`);
    this.name = "AppointmentStatusError";
  }
}

const OVERLAP_CONSTRAINT = "appointments_no_overlap";
const TOKEN_HASH = /^[0-9a-f]{64}$/;

function rethrowConflict(error: unknown): never {
  if (isConstraintViolation(error, OVERLAP_CONSTRAINT)) throw new AppointmentConflictError();
  throw error;
}

// Nomes para a agenda do painel e a página de gestão; nada além do necessário de cada relação.
const details = {
  professional: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, durationMinutes: true, priceCents: true } },
  contact: { select: { id: true, name: true, phone: true } },
} as const satisfies Prisma.AppointmentInclude;

export type AppointmentDetails = Prisma.AppointmentGetPayload<{ include: typeof details }>;

export interface AppointmentInput extends DateRange {
  professionalId: string;
  serviceId: string;
  contactId: string;
  // SHA-256 (hex) do token do link de gestão (D6); ausente no agendamento manual do dono.
  manageTokenHash?: string | null;
}

export interface RescheduleInput extends DateRange {
  // Troca de profissional junto com o horário; ausente mantém o atual.
  professionalId?: string;
}

export interface AppointmentRangeQuery extends DateRange {
  professionalId?: string;
  statuses?: readonly AppointmentStatus[];
}

export function createAppointmentsRepository(scope: TenantScope) {
  const { tenantId, db } = scope;

  const findDetailed = (id: string) =>
    db.appointment.findFirst({ where: { id, tenantId }, include: details });

  // Atualiza só se ainda estiver `confirmed` (condição no próprio UPDATE, sem corrida). Se nada
  // mudou, distingue inexistente (null), já no estado pedido (devolve) e estado inválido (erro).
  async function fromConfirmed(
    id: string,
    data: Prisma.AppointmentUncheckedUpdateManyInput,
    target?: AppointmentStatus,
  ): Promise<AppointmentDetails | null> {
    if (!isId(id)) return null;
    let count: number;
    try {
      ({ count } = await db.appointment.updateMany({
        where: { id, tenantId, status: "confirmed" },
        data,
      }));
    } catch (error) {
      rethrowConflict(error);
    }
    const current = await findDetailed(id);
    if (!current) return null;
    if (count === 0 && current.status !== target) throw new AppointmentStatusError(current.status);
    return current;
  }

  return {
    // Agendamentos que cruzam [startsAt, endsAt), inclusive os que começam antes da janela.
    listRange(query: AppointmentRangeQuery): Promise<AppointmentDetails[]> {
      const { startsAt, endsAt } = dateRangeSchema.parse(query);
      if (query.professionalId !== undefined && !isId(query.professionalId)) return Promise.resolve([]);
      return db.appointment.findMany({
        where: {
          tenantId,
          ...(query.professionalId ? { professionalId: query.professionalId } : {}),
          ...(query.statuses ? { status: { in: [...query.statuses] } } : {}),
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        include: details,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      });
    },

    findById(id: string): Promise<AppointmentDetails | null> {
      return isId(id) ? findDetailed(id) : Promise.resolve(null);
    },

    findByManageTokenHash(tokenHash: string): Promise<AppointmentDetails | null> {
      if (!TOKEN_HASH.test(tokenHash)) return Promise.resolve(null);
      return db.appointment.findFirst({ where: { tenantId, manageTokenHash: tokenHash }, include: details });
    },

    // null se profissional, serviço ou contato não forem do tenant. Regras de negócio (arquivado,
    // vínculo, horário livre) ficam para quem chama; aqui só a posse e a sobreposição.
    async create(input: AppointmentInput): Promise<AppointmentDetails | null> {
      const { startsAt, endsAt } = dateRangeSchema.parse(input);
      if (input.manageTokenHash != null && !TOKEN_HASH.test(input.manageTokenHash)) {
        throw new TypeError("manageTokenHash deve ser SHA-256 em hexadecimal");
      }
      const [professional, service, contact] = await Promise.all([
        professionalExists(scope, input.professionalId),
        serviceExists(scope, input.serviceId),
        contactExists(scope, input.contactId),
      ]);
      if (!professional || !service || !contact) return null;
      try {
        return await db.appointment.create({
          data: {
            tenantId,
            professionalId: input.professionalId,
            serviceId: input.serviceId,
            contactId: input.contactId,
            startsAt,
            endsAt,
            manageTokenHash: input.manageTokenHash ?? null,
          },
          include: details,
        });
      } catch (error) {
        rethrowConflict(error);
      }
    },

    // Remarcar atualiza o mesmo registro (o link de gestão continua valendo), sob a mesma constraint.
    async reschedule(id: string, input: RescheduleInput): Promise<AppointmentDetails | null> {
      const { startsAt, endsAt } = dateRangeSchema.parse(input);
      if (input.professionalId !== undefined && !(await professionalExists(scope, input.professionalId))) {
        return null;
      }
      return fromConfirmed(id, {
        startsAt,
        endsAt,
        ...(input.professionalId ? { professionalId: input.professionalId } : {}),
      });
    },

    // Cancelar de novo devolve o cancelado sem mudar a data; concluído não volta.
    cancel(id: string, at: Date = new Date()): Promise<AppointmentDetails | null> {
      return fromConfirmed(id, { status: "canceled", canceledAt: at }, "canceled");
    },

    complete(id: string): Promise<AppointmentDetails | null> {
      return fromConfirmed(id, { status: "completed" }, "completed");
    },
  };
}
