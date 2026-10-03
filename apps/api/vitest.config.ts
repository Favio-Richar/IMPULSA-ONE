import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")],
    // Los tests e2e de auth comparten Postgres/Redis reales — correr en serie evita que se
    // pisen entre sí (mismas tablas, mismas claves de rate limiting).
    fileParallelism: false,
    // Con la máquina cargada (Docker, otras aplicaciones) una prueba e2e sana puede pasar de los 5 s por defecto en la corrida completa y
    // pasar sola en 1 s: se espera más sin cambiar lo que se verifica. Una prueba rota sigue fallando, solo que más tarde.
    testTimeout: 15_000,
  },
});
