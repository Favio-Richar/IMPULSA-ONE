import * as argon2 from "argon2";

// Argon2id — recomendado por OWASP sobre bcrypt para hashing de contraseñas nuevo (ST §15,
// no negociable de seguridad). Parámetros por defecto de la librería ya siguen las
// recomendaciones actuales; no se afloja el costo por "performance".

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    // Hash corrupto/formato desconocido — nunca lanzar, tratar como contraseña incorrecta.
    return false;
  }
}
