import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PLAN_CATALOG, THEME_CATALOG } from "@impulza/validation";
import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from "../src/permissions.js";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}

const prisma = new PrismaClient();

// Roles técnicos iniciales (ST §7).
const ROLES = [
  { name: "OWNER", description: "Administra la organización, el sitio y la operación." },
  { name: "ADMIN", description: "Administración completa salvo baja/transferencia de la organización." },
  { name: "EDITOR", description: "Edita contenido del sitio sin acceso a configuración sensible." },
  { name: "ANALYST", description: "Solo lectura de analítica y reportes." },
  { name: "SUPPORT", description: "Soporte al cliente con acceso limitado y auditado." },
  { name: "AGENCY_MANAGER", description: "Gestiona múltiples cuentas de cliente en modo agencia." },
  { name: "SUPER_ADMIN", description: "Superadministración de la plataforma — rutas y guards aparte (ADR-002)." },
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }

  // Reconstruye las relaciones rol-permiso desde ROLE_PERMISSIONS (única fuente de verdad,
  // compartida con apps/api vía @impulza/database) — idempotente: borra y vuelve a crear.
  let rolePermissionCount = 0;
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const key of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      rolePermissionCount += 1;
    }
  }

  // Catálogo de planes (F4.1) — valores PROVISORIOS hasta la decisión #4 del propietario (ver
  // `packages/validation/src/plans`). Desde F4.4 (ADR-005 §7) la tabla es la fuente de verdad y se
  // edita desde la superadministración: el seed solo crea los planes que falten y **nunca**
  // sobrescribe uno existente, o volver a sembrar borraría lo que se editó allá.
  for (const plan of PLAN_CATALOG) {
    const data = {
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      currency: plan.currency,
      limits: plan.limits,
      sortOrder: plan.sortOrder,
    };
    await prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: { code: plan.code, ...data } });
  }

  // Temas del catálogo global (F2.5): organizationId null. Idempotente por `code`, de modo que
  // ajustar una paleta acá se propaga al volver a sembrar sin duplicar filas ni tocar los temas
  // propios de las organizaciones.
  for (const theme of THEME_CATALOG) {
    await prisma.theme.upsert({
      where: { code: theme.code },
      update: { name: theme.name, tokens: theme.tokens },
      create: { code: theme.code, name: theme.name, tokens: theme.tokens, organizationId: null },
    });
  }

  console.log(
    `Seed OK: ${ROLES.length} roles, ${PERMISSION_CATALOG.length} permisos, ` +
      `${rolePermissionCount} asignaciones rol-permiso, ${PLAN_CATALOG.length} planes, ` +
      `${THEME_CATALOG.length} temas de catálogo.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed falló:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
