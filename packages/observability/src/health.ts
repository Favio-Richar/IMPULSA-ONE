export type HealthCheckStatus = "ok" | "error";

export interface HealthCheckDefinition {
  name: string;
  check: () => Promise<void>;
  timeoutMs?: number;
}

export interface HealthReport {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
  checks: Record<string, HealthCheckStatus>;
}

async function withTimeout(promise: Promise<void>, timeoutMs: number, name: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health check "${name}" excedió ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Ejecuta cada dependencia declarada (DB, Redis, ...) con timeout individual y nunca lanza —
// una dependencia caída degrada el reporte, no tumba el endpoint de salud en sí.
export async function runHealthChecks(
  service: string,
  definitions: HealthCheckDefinition[],
): Promise<HealthReport> {
  const checks: Record<string, HealthCheckStatus> = {};

  for (const definition of definitions) {
    try {
      await withTimeout(definition.check(), definition.timeoutMs ?? 2000, definition.name);
      checks[definition.name] = "ok";
    } catch {
      checks[definition.name] = "error";
    }
  }

  const status = Object.values(checks).every((value) => value === "ok") ? "ok" : "degraded";

  return { status, service, timestamp: new Date().toISOString(), checks };
}
