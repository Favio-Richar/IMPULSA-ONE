import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "./context.js";
import { createLogger } from "./logger.js";

function lastWrittenLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  const raw = calls.at(-1)?.[0] as string;
  return JSON.parse(raw.trimEnd()) as Record<string, unknown>;
}

describe("logger", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emite una línea JSON con timestamp, nivel, servicio y mensaje", () => {
    const logger = createLogger("test-service");
    logger.info("hola mundo", { foo: "bar" });

    const record = lastWrittenLine(writeSpy);

    expect(record.level).toBe("info");
    expect(record.service).toBe("test-service");
    expect(record.message).toBe("hola mundo");
    expect(record.foo).toBe("bar");
    expect(typeof record.timestamp).toBe("string");
    expect(new Date(record.timestamp as string).toString()).not.toBe("Invalid Date");
  });

  it("inyecta request_id/trace_id cuando hay contexto activo", () => {
    const logger = createLogger("test-service");

    runWithRequestContext({ requestId: "req-123", traceId: "trace-123" }, () => {
      logger.warn("con contexto");
    });

    const record = lastWrittenLine(writeSpy);
    expect(record.request_id).toBe("req-123");
    expect(record.trace_id).toBe("trace-123");
  });

  it("request_id/trace_id son undefined sin contexto activo", () => {
    const logger = createLogger("test-service");
    logger.error("sin contexto");

    const record = lastWrittenLine(writeSpy);
    expect(record.request_id).toBeUndefined();
    expect(record.trace_id).toBeUndefined();
  });

  it("redacta claves sensibles en cualquier profundidad", () => {
    const logger = createLogger("test-service");
    logger.info("evento", {
      password: "hunter2",
      user: { token: "abc.def.ghi", nested: { authorization: "Bearer xyz" } },
      list: [{ apiKey: "shh" }],
      safe: "valor visible",
    });

    const record = lastWrittenLine(writeSpy) as {
      password: string;
      user: { token: string; nested: { authorization: string } };
      list: [{ apiKey: string }];
      safe: string;
    };

    expect(record.password).toBe("[REDACTED]");
    expect(record.user.token).toBe("[REDACTED]");
    expect(record.user.nested.authorization).toBe("[REDACTED]");
    expect(record.list[0].apiKey).toBe("[REDACTED]");
    expect(record.safe).toBe("valor visible");
  });

  it("serializa instancias de Error con name/message/stack", () => {
    const logger = createLogger("test-service");
    logger.error("fallo", { err: new Error("boom") });

    const record = lastWrittenLine(writeSpy) as { err: { name: string; message: string; stack: string } };
    expect(record.err.name).toBe("Error");
    expect(record.err.message).toBe("boom");
    expect(typeof record.err.stack).toBe("string");
  });
});
