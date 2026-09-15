// Prisma 7 movió la URL de conexión para Migrate/CLI fuera de schema.prisma hacia este archivo
// (el `datasource { url = env(...) }` clásico ya no está soportado). El PrismaClient en
// tiempo de ejecución usa un driver adapter aparte — ver src/index.ts.
import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma ya no carga .env automáticamente al leer este archivo (a diferencia de versiones
// anteriores) — se carga explícitamente. Si no existe (p. ej. en CI, donde las variables ya
// vienen inyectadas por el entorno), simplemente se ignora.
try {
  process.loadEnvFile(path.join(import.meta.dirname, ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno.
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
