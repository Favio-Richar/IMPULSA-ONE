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

export async function verifyTwoFactorCode(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: code });
    return result.valid;
  } catch {
    return false;
  }
}
