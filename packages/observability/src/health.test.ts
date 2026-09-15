import { describe, expect, it } from "vitest";
import { runHealthChecks } from "./health.js";

describe("runHealthChecks", () => {
  it("status ok cuando todas las dependencias responden", async () => {
    const report = await runHealthChecks("api", [
      { name: "database", check: async () => {} },
      { name: "redis", check: async () => {} },
    ]);

    expect(report.status).toBe("ok");
    expect(report.service).toBe("api");
    expect(report.checks).toEqual({ database: "ok", redis: "ok" });
    expect(new Date(report.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("status degraded cuando una dependencia lanza", async () => {
    const report = await runHealthChecks("api", [
      { name: "database", check: async () => {} },
      {
        name: "redis",
        check: async () => {
          throw new Error("conexión rechazada");
        },
      },
    ]);

    expect(report.status).toBe("degraded");
    expect(report.checks).toEqual({ database: "ok", redis: "error" });
  });

  it("status degraded cuando una dependencia excede el timeout", async () => {
    const report = await runHealthChecks("api", [
      {
        name: "lenta",
        timeoutMs: 10,
        check: () => new Promise((resolve) => setTimeout(resolve, 1000)),
      },
    ]);

    expect(report.status).toBe("degraded");
    expect(report.checks.lenta).toBe("error");
  });
});
