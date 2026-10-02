import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BULLMQ_QUEUES } from "@impulza/validation";

// El panel de operaciones pausa, reintenta y purga colas por nombre. Si un nombre no existe en el
// sistema, la acción se aplica a una cola vacía creada al vuelo y el superadministrador cree haber
// controlado algo que no controló (la primera versión de F7.11 tenía 4 nombres inventados). Esta
// prueba lee el código fuente: toda constante `*_QUEUE = "nombre"` de los productores y workers.

const ROOT = resolve(import.meta.dirname, "../../../../..");
const SOURCE_DIRS = ["apps/api/src", "apps/worker/src", "packages/analytics/src", "packages/storage/src", "packages/webhooks/src", "packages/validation/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" || entry === "dist" ? [] : sourceFiles(full);
    return /\.ts$/.test(entry) && !/\.(test|d)\.ts$/.test(entry) ? [full] : [];
  });
}

function declaredQueueNames(): string[] {
  const names = new Set<string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      for (const match of readFileSync(file, "utf8").matchAll(/export const [A-Z_]+_QUEUE\s*=\s*"([a-z-]+)"/g)) {
        names.add(match[1]!);
      }
    }
  }
  return [...names];
}

describe("nombres de cola del panel de operaciones (F7.11)", () => {
  it("BULLMQ_QUEUES es exactamente el conjunto de colas declaradas en el código", () => {
    expect([...BULLMQ_QUEUES].sort()).toEqual(declaredQueueNames().sort());
  });
});
