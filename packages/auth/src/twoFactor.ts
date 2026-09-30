import { generateSecret, generateURI, verify } from "otplib";

// Diseño de datos + endpoints base de 2FA (F1.4) — no se exige todavía en el login (ST §7:
// "2FA antes de producción comercial"). El secreto nunca se persiste en claro: quien llama a
// generateTwoFactorSecret es responsable de cifrarlo con packages/auth/crypto antes de guardarlo.

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

export function generateTwoFactorSecret(accountLabel: string, issuer = "Impulza One"): TwoFactorSetup {
  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer, label: accountLabel, secret });
  return { secret, otpauthUrl };
}

/**
 * Tolerancia hacia atrás de un paso (30 s), nunca hacia adelante (RFC 6238 §5.2): un código escrito
 * en los últimos segundos de su ventana llega al servidor cuando ya empezó la siguiente, y sin esto
 * se rechazaría aunque sea correcto. La anti-repetición (cada código vale una vez, recordado 2 min
 * en la administración) cubre esta ventana ampliada.
 */
export const TOTP_PAST_TOLERANCE_SECONDS = 30;

export async function verifyTwoFactorCode(secret: string, code: string, epoch?: number): Promise<boolean> {
  try {
    const result = await verify({ secret, token: code, epochTolerance: [TOTP_PAST_TOLERANCE_SECONDS, 0], ...(epoch !== undefined ? { epoch } : {}) });
    return result.valid;
  } catch {
    return false;
  }
}
