import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifrado simétrico para datos sensibles en reposo que sí necesitan poder leerse de vuelta
// (a diferencia de contraseñas/tokens, que solo se hashean). Uso actual: secreto TOTP de 2FA
// (User.twoFactorSecretEncrypted) — nunca se guarda en claro (ST §15/§16, no negociable).
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadKey(rawKey: string): Buffer {
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY debe ser una clave de 32 bytes en base64 (ej: `openssl rand -base64 32`).",
    );
  }
  return key;
}

export function encryptSecret(plainText: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const [ivB64, authTagB64, encryptedB64] = payload.split(".");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Payload cifrado con formato inválido.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
