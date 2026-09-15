import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")],
    // Los tests e2e de auth comparten Postgres/Redis reales — correr en serie evita que se
    // pisen entre sí (mismas tablas, mismas claves de rate limiting).
    fileParallelism: false,
  },
});
