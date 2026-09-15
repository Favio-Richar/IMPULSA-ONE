import path from "node:path";

// vitest no carga .env por sí solo (a diferencia de tsx --env-file usado en dev/start) —
// se carga explícitamente para que packages/config pueda validar el entorno en los tests.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}
