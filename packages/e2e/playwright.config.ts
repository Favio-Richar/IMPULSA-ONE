import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// El resto del repo valida su entorno al arrancar; acá se hace lo mismo antes de levantar nada,
// para no descubrir a mitad de una prueba que el servidor nunca subió por una variable faltante.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya vienen del entorno (CI).
}

export const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";
// `/health` queda fuera del prefijo global `/api/v1` a propósito (apps/api/src/main.ts) para que
// un balanceador o un contenedor puedan sondearlo sin conocer la versión de la API.
const API_HEALTH_URL = new URL("/health", API_BASE_URL).toString();
export const DASHBOARD_URL = process.env.E2E_DASHBOARD_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.playwright",
  globalSetup: "./global-setup.ts",
  // Las pruebas comparten una única organización sembrada y tocan la misma página, así que corren
  // en serie a propósito: el paralelismo acá no ahorra tiempo real y sí vuelve los fallos no
  // reproducibles, que es lo peor que le puede pasar a una prueba de interfaz.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: DASHBOARD_URL,
    storageState: "./.playwright/session.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-CL",
  },
  projects: [
    // Los dos extremos que importan para el criterio "responsive real" de F2.9: un teléfono de
    // verdad (no el simulador de dispositivo de la vista previa, que solo cambia el ancho del
    // iframe) y un escritorio, con el mismo archivo de pruebas.
    { name: "movil", use: { ...devices["Pixel 7"] } },
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @impulza/api dev",
      url: API_HEALTH_URL,
      cwd: path.join(import.meta.dirname, "..", ".."),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @impulza/dashboard dev",
      url: DASHBOARD_URL,
      cwd: path.join(import.meta.dirname, "..", ".."),
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
