import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WEBHOOK_SIGNATURE_SNIPPET } from "@impulza/validation";
import { generateWebhookSecret, isPublicAddress, retryDelayMs, MAX_ATTEMPTS, sendWebhook, signWebhook, verifyWebhookSignature } from "./index.js";

describe("SSRF: direcciones no públicas (ADR-017)", () => {
  it("bloquea loopback, redes privadas, metadata de la nube, CGNAT, multicast y reservadas", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "2002:a00:1::",
      "no-es-una-ip",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("deja pasar direcciones públicas", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("un envío a un host que resuelve a loopback se corta al conectar, aunque la URL sea https", async () => {
    const result = await sendWebhook({ url: "https://localhost:9/hook", body: "{}", headers: {} });
    expect(result).toMatchObject({ ok: false, status: null, error: "unsafe_destination" });
    // Una IP literal no pasa por el DNS: se revisa antes de conectar (también IPv6 y mapeadas).
    for (const url of ["https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/hook", "https://[::ffff:10.0.0.1]/hook", "https://10.1.2.3/hook"]) {
      expect((await sendWebhook({ url, body: "{}", headers: {} })).error, url).toBe("unsafe_destination");
    }
  });

  it("sin el permiso de pruebas, http:// no se envía", async () => {
    expect((await sendWebhook({ url: "http://example.com/hook", body: "{}", headers: {} })).error).toBe("insecure_url");
  });
});

describe("firma (ADR-017 §2)", () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ id: "evt_1", type: "ping" });

  it("el secreto es aleatorio y con prefijo", () => {
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it("verifica la firma correcta y rechaza otro cuerpo, otro secreto, otra marca o una vieja", () => {
    const header = signWebhook(secret, body, 1_000_000);
    expect(verifyWebhookSignature({ header, body, secret, nowSeconds: 1_000_010 })).toBe(true);
    expect(verifyWebhookSignature({ header, body: `${body} `, secret, nowSeconds: 1_000_010 })).toBe(false);
    expect(verifyWebhookSignature({ header, body, secret: generateWebhookSecret(), nowSeconds: 1_000_010 })).toBe(false);
    expect(verifyWebhookSignature({ header: header.replace("t=1000000", "t=1000001"), body, secret, nowSeconds: 1_000_010 })).toBe(false);
    // Reenviado 10 minutos después: fuera de la tolerancia de 5.
    expect(verifyWebhookSignature({ header, body, secret, nowSeconds: 1_000_600 })).toBe(false);
    for (const junk of [null, "", "t=abc,v1=zz", "v1=" + "a".repeat(64), "t=1000000"]) {
      expect(verifyWebhookSignature({ header: junk, body, secret, nowSeconds: 1_000_010 })).toBe(false);
    }
  });

  it("acepta cualquiera de varias firmas v1 (rotación del secreto)", () => {
    const other = generateWebhookSecret();
    const first = signWebhook(other, body, 2_000_000);
    const second = signWebhook(secret, body, 2_000_000).split(",")[1];
    expect(verifyWebhookSignature({ header: `${first},${second}`, body, secret, nowSeconds: 2_000_000 })).toBe(true);
  });
});

describe("reintentos", () => {
  it("8 intentos en total, con esperas crecientes", () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(8)).toBe(12 * 3_600_000);
    expect(retryDelayMs(9)).toBeNull();
    expect(retryDelayMs(1)).toBeNull();
  });
});

describe("envío contra un servidor HTTP real", () => {
  let server: Server;
  let base = "";
  const received: Array<{ headers: Record<string, unknown>; body: string }> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push({ headers: request.headers, body });
        if (request.url === "/ok") response.writeHead(200).end("ok");
        else if (request.url === "/gone") response.writeHead(410).end();
        else if (request.url === "/redirect") response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end();
        else if (request.url === "/big") response.writeHead(200).end("x".repeat(1_000_000));
        else if (request.url === "/slow") setTimeout(() => response.writeHead(200).end(), 2_000);
        else response.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const send = (path: string, timeoutMs?: number) =>
    sendWebhook({ url: `${base}${path}`, body: '{"hola":1}', headers: { "Impulza-Signature": "t=1,v1=x" }, timeoutMs, unsafeAllowPrivateNetwork: true });

  it("2xx es entregado, con el cuerpo y las cabeceras tal cual", async () => {
    const result = await send("/ok");
    expect(result).toMatchObject({ ok: true, status: 200, error: null });
    expect(received.at(-1)).toMatchObject({ body: '{"hola":1}', headers: { "impulza-signature": "t=1,v1=x", "content-type": "application/json" } });
  });

  it("no sigue redirecciones (un 3xx es una falla), y 410 y 5xx se informan", async () => {
    const redirect = await send("/redirect");
    expect(redirect).toMatchObject({ ok: false, status: 302, error: "redirect_not_followed" });
    expect(received.filter((entry) => entry.headers.host?.toString().includes("169.254"))).toHaveLength(0);
    expect(await send("/gone")).toMatchObject({ ok: false, status: 410, error: "http_410" });
    expect(await send("/error")).toMatchObject({ ok: false, status: 500 });
  });

  it("corta por tiempo y no lee respuestas enormes", async () => {
    expect(await send("/slow", 300)).toMatchObject({ ok: false, status: null, error: "timeout" });
    const big = await send("/big");
    expect(big.status).toBe(200);
  });
});

describe("guía del panel: el código de verificación que se le muestra al negocio", () => {
  it("acepta lo que firma Impulza y rechaza lo alterado o viejo", async () => {
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    // El fragmento es ESM para el negocio; acá se evalúa su función con las mismas dependencias.
    const source = WEBHOOK_SIGNATURE_SNIPPET.replace(/^import .*$/m, "").replace("export function", "return function");
    const isFromImpulza = new Function("createHmac", "timingSafeEqual", "Buffer", source)(createHmac, timingSafeEqual, Buffer) as (body: string, header: string, secret: string) => boolean;
    const secret = generateWebhookSecret();
    const body = JSON.stringify({ id: "evt", type: "order.paid", data: { total: 1 } });
    const header = signWebhook(secret, body, Math.floor(Date.now() / 1000));
    expect(isFromImpulza(body, header, secret)).toBe(true);
    expect(isFromImpulza(`${body} `, header, secret)).toBe(false);
    expect(isFromImpulza(body, header, generateWebhookSecret())).toBe(false);
    expect(isFromImpulza(body, signWebhook(secret, body, Math.floor(Date.now() / 1000) - 600), secret)).toBe(false);
    expect(isFromImpulza(body, "basura", secret)).toBe(false);
  });
});
