import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

// Peças comuns aos repositórios por domínio (guia 6, D2): escopo do tenant, IDs e erros do banco.

export class TenantScopeError extends Error {
  constructor() {
    super("Repositório exige um tenantId válido");
    this.name = "TenantScopeError";
  }
}

// Todo módulo de domínio recebe o escopo já validado e embute tenantId em cada query.
export interface TenantScope {
  tenantId: string;
  db: PrismaClient;
}

export interface ListOptions {
  includeArchived?: boolean;
}

const idSchema = z.uuid();

export const isId = (value: unknown): value is string => idSchema.safeParse(value).success;

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// Restrições de exclusão (EXCLUDE gist) e CHECKs não viram código Prisma próprio: o nome da
// constraint aparece na mensagem ou no meta, conforme o driver.
export function isConstraintViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error)) return false;
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : "";
  return error.message.includes(constraint) || meta.includes(constraint);
}

export async function orNull<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// IDs malformados se comportam como inexistentes, sem chegar ao banco.
export const byId = <T>(id: string, run: () => Promise<T>): Promise<T | null> =>
  isId(id) ? orNull(run()) : Promise.resolve(null);

export const professionalExists = async ({ tenantId, db }: TenantScope, id: string): Promise<boolean> =>
  isId(id) && (await db.professional.count({ where: { id, tenantId } })) > 0;

export const serviceExists = async ({ tenantId, db }: TenantScope, id: string): Promise<boolean> =>
  isId(id) && (await db.service.count({ where: { id, tenantId } })) > 0;

export const contactExists = async ({ tenantId, db }: TenantScope, id: string): Promise<boolean> =>
  isId(id) && (await db.contact.count({ where: { id, tenantId } })) > 0;
