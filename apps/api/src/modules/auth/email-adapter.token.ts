// Token en su propio archivo para evitar un ciclo de imports entre auth.module.ts y
// auth.service.ts (Nest evalúa decoradores en tiempo de carga del módulo ESM).
export const EMAIL_ADAPTER = Symbol("EMAIL_ADAPTER");
