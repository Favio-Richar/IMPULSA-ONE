import path from "node:path";

// Igual que en apps/api: vitest no carga .env por sí solo, y las pruebas de esquema necesitan
// DATABASE_URL para conectarse al Postgres real.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}
