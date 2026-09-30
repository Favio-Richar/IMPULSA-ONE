import path from "node:path";
import { useTestServices } from "@impulza/config";

// Las pruebas del worker usan Postgres y Redis reales: los **de pruebas** (`TEST_DATABASE_URL`/
// `TEST_REDIS_URL`), nunca los de desarrollo. Se carga el .env primero y después se reemplaza;
// `load-dotenv.js` (que importan las pruebas) no pisa variables ya definidas.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}
useTestServices();
