import path from "node:path";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}

const prisma = new PrismaClient();

// Roles técnicos iniciales (ST §7) — el catálogo de permisos por rol se implementa en F1.6.
const ROLES = [
  { name: "OWNER", description: "Administra la organización, el sitio y la operación." },
  { name: "ADMIN", description: "Administración completa salvo baja/transferencia de la organización." },
  { name: "EDITOR", description: "Edita contenido del sitio sin acceso a configuración sensible." },
  { name: "ANALYST", description: "Solo lectura de analítica y reportes." },
  { name: "SUPPORT", description: "Soporte al cliente con acceso limitado y auditado." },
  { name: "AGENCY_MANAGER", description: "Gestiona múltiples cuentas de cliente en modo agencia." },
  { name: "SUPER_ADMIN", description: "Superadministración de la plataforma — rutas y guards aparte (ADR-002)." },
];

// Moneda/mercado de lanzamiento son decisiones pendientes explícitas (PM §21 #1-2) — CLP es un
// valor provisional de desarrollo, no una decisión comercial tomada.
const FREE_PLAN = {
  code: "free",
  name: "Gratis",
  price: 0,
  currency: "CLP",
  limits: {
    sites: 1,
    pagesPerSite: 3,
    contacts: 100,
    storageMb: 200,
  },
};

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  await prisma.plan.upsert({
    where: { code: FREE_PLAN.code },
    update: {
      name: FREE_PLAN.name,
      price: FREE_PLAN.price,
      currency: FREE_PLAN.currency,
      limits: FREE_PLAN.limits,
    },
    create: FREE_PLAN,
  });

  console.log(`Seed OK: ${ROLES.length} roles, 1 plan (${FREE_PLAN.code}).`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed falló:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
