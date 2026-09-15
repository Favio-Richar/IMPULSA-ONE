import path from "node:path";

// Debe ser el primer import de main.ts — carga .env antes de que cualquier otro módulo (env.ts
// incluido) lea process.env. En producción no existe el archivo y simplemente no hace nada (las
// variables ya vienen inyectadas por el entorno real).
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno.
}
