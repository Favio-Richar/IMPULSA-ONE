import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHealthServer } from "./health-server.js";

describe("health server (worker)", () => {
  let baseUrl: string;
  const server = createHealthServer();

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health responde 200 con status ok (liveness, sin dependencias todavía)", async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string; service: string; checks: unknown };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("impulza-worker");
    expect(body.checks).toEqual({});
  });

  it("cualquier otra ruta responde 404", async () => {
    const response = await fetch(`${baseUrl}/no-existe`);
    expect(response.status).toBe(404);
  });
});
