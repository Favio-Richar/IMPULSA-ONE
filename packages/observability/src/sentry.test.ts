import { afterEach, describe, expect, it } from "vitest";
import { captureException, closeSentry, initSentry, isSentryEnabled } from "./sentry.js";

describe("sentry", () => {
  afterEach(async () => {
    await closeSentry();
  });

  it("sin DSN queda deshabilitado (no-op) y no lanza", () => {
    initSentry({ environment: "test", service: "api" });
    expect(isSentryEnabled()).toBe(false);
    expect(() => captureException(new Error("no debería enviarse"))).not.toThrow();
  });

  it("con DSN válido queda habilitado", () => {
    initSentry({
      dsn: "https://public@o0.ingest.sentry.io/0",
      environment: "test",
      service: "api",
    });
    expect(isSentryEnabled()).toBe(true);
  });
});
