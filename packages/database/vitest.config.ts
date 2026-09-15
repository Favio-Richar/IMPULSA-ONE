import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")],
    // Las pruebas de invariantes del esquema (F2.1) usan el Postgres real de docker-compose —
    // en serie para que no se pisen entre sí con los datos de prueba.
    fileParallelism: false,
  },
});
