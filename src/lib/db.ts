import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  return url;
}

// Uma instância por processo; em dev o hot reload reaproveita a do globalThis.
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient(databaseUrl());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
