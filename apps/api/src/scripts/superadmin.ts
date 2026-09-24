import "../load-dotenv.js";
import { PrismaClient } from "@impulza/database";
import { env } from "../env.js";
import { grantSuperAdmin, revokeSuperAdmin, SuperAdminGrantError } from "../modules/admin/superadmin-grants.js";

// Script de operación (ADR-005 §2): la ÚNICA forma de otorgar o quitar superadministración.
//
//   pnpm --filter @impulza/api run superadmin -- grant correo@ejemplo.com
//   pnpm --filter @impulza/api run superadmin -- revoke correo@ejemplo.com
//
// Lo corre quien tiene acceso al servidor y a la base de datos. La salida es para una persona en
// una terminal: por eso usa console y no el logger JSON de la API.

const [command, email] = process.argv.slice(2).filter((arg) => arg !== "--");
const prisma = new PrismaClient();

async function main(): Promise<void> {
  if ((command !== "grant" && command !== "revoke") || !email) {
    console.error("Uso: superadmin grant|revoke <correo>");
    process.exitCode = 2;
    return;
  }

  if (command === "revoke") {
    const result = await revokeSuperAdmin(prisma, email);
    console.log(`Superadministración revocada a ${result.email}. Sesiones de administración cerradas: ${result.closedSessions}.`);
    return;
  }

  const result = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
  console.log(
    result.alreadySuperAdmin
      ? `${result.email} ya era superadministrador.`
      : `${result.email} ahora es superadministrador.`,
  );
  if (result.twoFactorEnrollment) {
    console.log("\n2FA activado. Carga esta clave en tu app autenticadora (Google Authenticator, 1Password, etc.).");
    console.log("Se muestra UNA sola vez; no queda guardada en claro en ningún lado.\n");
    console.log(`  Clave:  ${result.twoFactorEnrollment.secret}`);
    console.log(`  URL:    ${result.twoFactorEnrollment.otpauthUrl}\n`);
  } else {
    console.log("La cuenta ya tenía 2FA activo: usa el mismo código de tu app autenticadora.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof SuperAdminGrantError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
