import { PrismaClient } from "@prisma/client";

// Singleton — evita agotar el pool de conexiones de Postgres cuando el dev server recarga
// módulos (tsx watch / Next.js dev). Patrón estándar de Prisma para monorepos.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export { PERMISSIONS, PERMISSION_CATALOG, ROLE_PERMISSIONS, type PermissionKey } from "./permissions.js";
