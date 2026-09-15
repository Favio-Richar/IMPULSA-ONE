import { describe, expect, it } from "vitest";
import { getRequestId, getTraceId, runWithRequestContext } from "./context.js";

describe("context", () => {
  it("no hay contexto fuera de runWithRequestContext", () => {
    expect(getRequestId()).toBeUndefined();
    expect(getTraceId()).toBeUndefined();
  });

  it("expone requestId/traceId dentro del contexto", () => {
    runWithRequestContext({ requestId: "req-1", traceId: "trace-1" }, () => {
      expect(getRequestId()).toBe("req-1");
      expect(getTraceId()).toBe("trace-1");
    });
  });

  it("se propaga a través de código async (await, setTimeout)", async () => {
    await runWithRequestContext({ requestId: "req-2", traceId: "trace-2" }, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(getRequestId()).toBe("req-2");
      expect(getTraceId()).toBe("trace-2");
    });
  });

  it("contextos concurrentes no se mezclan entre sí", async () => {
    const results: string[] = [];

    await Promise.all([
      runWithRequestContext({ requestId: "a", traceId: "a" }, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        results.push(getRequestId() ?? "unknown");
      }),
      runWithRequestContext({ requestId: "b", traceId: "b" }, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        results.push(getRequestId() ?? "unknown");
      }),
    ]);

    expect(results.sort()).toEqual(["a", "b"]);
  });
});
