import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Respuestas de `/api/v1/auth`. Ninguna incluye hash, secreto 2FA ni token: lo que no aparece acá
// es tan parte del contrato como lo que aparece.

export const registerResponse = z.object({
  userId: uuid,
});

export const loginResponse = z.object({
  // La sesión viaja en cookie HttpOnly, nunca en el cuerpo — por eso acá solo va la identidad.
  user: z.object({ id: uuid, email: z.email() }),
});

export const currentUserResponse = z.object({
  id: uuid,
  email: z.email(),
  emailVerifiedAt: isoDateTime.nullable(),
});

export const sessionResponse = z.object({
  id: uuid,
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  userAgent: z.string().nullable(),
  /** La sesión desde la que se hizo esta petición: el panel la marca para no cerrarla por error. */
  current: z.boolean(),
});

/**
 * Único momento en que el secreto 2FA sale del servidor en claro: el usuario tiene que poder
 * escribirlo en su aplicación de autenticación. Después queda cifrado y no vuelve a exponerse.
 */
export const twoFactorSetupResponse = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
});

export type RegisterResponse = z.infer<typeof registerResponse>;
export type LoginResponse = z.infer<typeof loginResponse>;
export type CurrentUserResponse = z.infer<typeof currentUserResponse>;
export type SessionResponse = z.infer<typeof sessionResponse>;
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponse>;
