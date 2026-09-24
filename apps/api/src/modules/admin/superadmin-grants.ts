import { encryptSecret, generateTwoFactorSecret } from "@impulza/auth";
import { type PrismaClient, SessionScope } from "@impulza/database";

export class SuperAdminGrantError extends Error {}

export interface GrantResult {
  email: string;
  alreadySuperAdmin: boolean;
  /** Solo si esta llamada enroló el 2FA: se muestra **una vez** al operador y nunca se guarda en claro. */
  twoFactorEnrollment: { secret: string; otpauthUrl: string } | null;
}

/**
 * Otorga la marca de superadministrador (ADR-005 §2–3). Solo la usa el script de operación del
 * servidor: no hay endpoint que la llame. Si la cuenta no tiene 2FA, lo enrola en el mismo paso
 * (secreto cifrado, activo desde ya) — nunca existe un superadministrador sin segundo factor.
 */
export async function grantSuperAdmin(prisma: PrismaClient, email: string, encryptionKey: string): Promise<GrantResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new SuperAdminGrantError(`No existe una cuenta con el correo ${email}. Debe registrarse primero.`);
  }
  if (!user.emailVerifiedAt) {
    throw new SuperAdminGrantError(`La cuenta ${email} no verificó su correo.`);
  }

  let twoFactorEnrollment: GrantResult["twoFactorEnrollment"] = null;
  const data: { isSuperAdmin: true; twoFactorEnabled?: true; twoFactorSecretEncrypted?: string } = { isSuperAdmin: true };
  if (!user.twoFactorEnabled || !user.twoFactorSecretEncrypted) {
    const { secret, otpauthUrl } = generateTwoFactorSecret(`${user.email} (administración)`);
    data.twoFactorEnabled = true;
    data.twoFactorSecretEncrypted = encryptSecret(secret, encryptionKey);
    twoFactorEnrollment = { secret, otpauthUrl };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data }),
    prisma.auditLog.create({
      data: {
        actorId: null,
        action: "admin.superadmin_granted",
        targetType: "User",
        targetId: user.id,
        metadata: { via: "cli", email: user.email, twoFactorEnrolled: twoFactorEnrollment !== null },
      },
    }),
  ]);

  return { email: user.email, alreadySuperAdmin: user.isSuperAdmin, twoFactorEnrollment };
}

/** Quita la marca y cierra en el acto todas sus sesiones de administración (ADR-005 §3). El 2FA
 *  queda como está: es de la cuenta, no del rol. */
export async function revokeSuperAdmin(prisma: PrismaClient, email: string): Promise<{ email: string; closedSessions: number }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new SuperAdminGrantError(`No existe una cuenta con el correo ${email}.`);
  }

  const [, closed] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: false } }),
    prisma.session.deleteMany({ where: { userId: user.id, scope: SessionScope.ADMIN } }),
    prisma.auditLog.create({
      data: {
        actorId: null,
        action: "admin.superadmin_revoked",
        targetType: "User",
        targetId: user.id,
        metadata: { via: "cli", email: user.email },
      },
    }),
  ]);

  return { email: user.email, closedSessions: closed.count };
}
