import { createHash, randomBytes } from "node:crypto";

export interface GeneratedToken {
  /** Se envía una vez al usuario (email) — nunca se persiste ni se loguea. */
  raw: string;
  /** Lo único que se guarda en base de datos (VerificationToken.tokenHash). */
  hash: string;
}

export function generateVerificationToken(): GeneratedToken {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
