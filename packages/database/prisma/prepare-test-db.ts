import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Prepara la base **de pruebas** (`TEST_DATABASE_URL`): la crea si no existe, aplica las
// migraciones y siembra el catálogo (roles, permisos, planes, temas, plantillas). Así las pruebas
// nunca comparten datos con la base de desarrollo — ni con el worker de desarrollo, que la recorre
// cada hora — y la de desarrollo nunca recibe datos de prueba.
//
// Sin `TEST_DATABASE_URL` no hace nada: en CI `DATABASE_URL` ya es una base desechable y el propio
// workflow la migra y siembra.

const root = path.join(import.meta.dirname, "..", "..", "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // sin .env local
}

const testUrl = process.env.TEST_DATABASE_URL;
const devUrl = process.env.DATABASE_URL;

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function main(): Promise<void> {
  if (!testUrl) {
    console.log("db:test:prepare — sin TEST_DATABASE_URL: las pruebas usan DATABASE_URL tal cual (CI).");
    return;
  }
  const name = databaseName(testUrl);
  // Salvaguardas: jamás preparar (ni vaciar, ni sembrar) algo que no sea una base de pruebas.
  if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test" (es "${name}").`);
  if (devUrl && databaseName(devUrl) === name && new URL(devUrl).host === new URL(testUrl).host) {
    throw new Error("TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL.");
  }
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Nombre de base de pruebas inválido: "${name}".`);

  // Crear la base si no existe, conectándose a la base de mantenimiento del mismo servidor.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const exists = await admin.$queryRawUnsafe<Array<{ found: number }>>(`SELECT 1 AS found FROM pg_database WHERE datname = '${name}'`);
    if (exists.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      console.log(`db:test:prepare — base "${name}" creada.`);
    }
  } finally {
    await admin.$disconnect();
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  const cwd = path.join(import.meta.dirname, "..");
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { cwd, env, stdio: "inherit" });
  console.log(`db:test:prepare — base de pruebas "${name}" lista.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
