import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiProviderError,
  AiUnavailableError,
  AnthropicProvider,
  estimateCostMicroUsd,
  extractJson,
  FakeProvider,
  OpenAiCompatibleProvider,
  runWithFallback,
  type AiConnectionConfig,
  type AiRequest,
} from "./index.js";

const schema = z.object({ headline: z.string().min(1).max(60) });
const request: AiRequest<{ headline: string }> = {
  system: "Eres redactor.",
  prompt: "Propón un titular.",
  schema,
  schemaName: "headline",
  maxOutputTokens: 200,
};

function connection(overrides: Partial<AiConnectionConfig> = {}): AiConnectionConfig {
  return {
    id: "c1",
    name: "Local",
    kind: "OPENAI_COMPATIBLE",
    baseUrl: "http://ia.interna:11434/v1/",
    apiKey: "secreto",
    model: "qwen2.5:14b",
    jsonMode: "json_schema",
    timeoutMs: 5_000,
    inputMicroUsdPerMTok: 0,
    outputMicroUsdPerMTok: 0,
    ...overrides,
  };
}

const noSleep = async () => {};

describe("extractJson", () => {
  it("acepta JSON limpio, con bloque de código o con texto alrededor; nada decodificable es undefined", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Claro, aquí va: {"a":{"b":2}} ¡listo!')).toEqual({ a: { b: 2 } });
    expect(extractJson("no hay json")).toBeUndefined();
  });
});

describe("runWithFallback (ADR-010)", () => {
  it("devuelve la salida validada y registra el intento con su costo", async () => {
    const provider = new FakeProvider([{ output: { headline: "Fotos que venden" }, inputTokens: 1_000_000, outputTokens: 500_000 }]);
    const paid = connection({ inputMicroUsdPerMTok: 2_000_000, outputMicroUsdPerMTok: 10_000_000 });
    const result = await runWithFallback([paid], request, () => provider, { sleep: noSleep });
    expect(result.data).toEqual({ headline: "Fotos que venden" });
    expect(result.attempts).toEqual([
      expect.objectContaining({ connectionId: "c1", outcome: "ok", inputTokens: 1_000_000, outputTokens: 500_000, costMicroUsd: 7_000_000 }),
    ]);
  });

  it("una salida que no cumple el esquema se reintenta en la misma conexión y nunca se devuelve cruda", async () => {
    const provider = new FakeProvider([{ output: { headline: "" } }, { output: { headline: "Segundo intento" } }]);
    const result = await runWithFallback([connection()], request, () => provider, { sleep: noSleep });
    expect(result.data.headline).toBe("Segundo intento");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["invalid_output", "ok"]);
  });

  it("un error definitivo pasa directo a la siguiente conexión; uno transitorio agota antes sus reintentos", async () => {
    const local = new FakeProvider([new AiProviderError("provider_error", true, "caído"), new AiProviderError("timeout", true, "lento")]);
    const denied = new FakeProvider([new AiProviderError("auth_error", false, "clave mala")]);
    const cloud = new FakeProvider([{ output: { headline: "Desde el respaldo" } }]);
    const providers: Record<string, FakeProvider> = { local, denied, cloud };
    const sleeps: number[] = [];
    const result = await runWithFallback(
      [connection({ id: "local" }), connection({ id: "denied" }), connection({ id: "cloud" })],
      request,
      (c) => providers[c.id]!,
      { sleep: async (ms) => void sleeps.push(ms), backoffMs: 100 },
    );
    expect(result.data.headline).toBe("Desde el respaldo");
    expect(result.attempts.map((a) => `${a.connectionId}:${a.outcome}`)).toEqual(["local:provider_error", "local:timeout", "denied:auth_error", "cloud:ok"]);
    expect(denied.requests).toHaveLength(1);
    expect(sleeps).toEqual([100]);
  });

  it("sin conexiones, o si todas fallan, lanza AiUnavailableError con los intentos", async () => {
    await expect(runWithFallback([], request, () => new FakeProvider())).rejects.toBeInstanceOf(AiUnavailableError);
    const error = await runWithFallback([connection()], request, () => new FakeProvider(), { sleep: noSleep }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).attempts.map((a) => a.outcome)).toEqual(["provider_error", "provider_error"]);
  });

  it("el costo nunca se subestima (redondeo hacia arriba) y un modelo propio cuesta 0", () => {
    expect(estimateCostMicroUsd(connection({ inputMicroUsdPerMTok: 1 }), 1, 0)).toBe(1);
    expect(estimateCostMicroUsd(connection(), 10_000, 10_000)).toBe(0);
  });
});

describe("adaptador compatible con OpenAI", () => {
  function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return respond(String(url), init!);
    }) as typeof fetch;
    return { impl, calls };
  }

  const ok = (content: string, finish = "stop") =>
    Response.json({ model: "qwen2.5:14b", choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 7 } });

  it("pide JSON por esquema estricto, con el token y sin seguir redirecciones", async () => {
    const { impl, calls } = fakeFetch(() => ok('{"headline":"Hola"}'));
    const result = await new OpenAiCompatibleProvider(connection(), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(1000));
    expect(result).toEqual({ output: { headline: "Hola" }, inputTokens: 12, outputTokens: 7, model: "qwen2.5:14b" });
    expect(calls[0]!.url).toBe("http://ia.interna:11434/v1/chat/completions");
    expect(calls[0]!.init.redirect).toBe("error");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secreto");
    const body = JSON.parse(String(calls[0]!.init.body)) as { response_format: { type: string; json_schema: { strict: boolean; schema: { required: string[] } } }; messages: Array<{ content: string }> };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["headline"]);
    // El esquema también va en las instrucciones, para modelos que ignoran response_format.
    expect(body.messages[0]!.content).toContain('"headline"');
  });

  it("en modo json_object o prompt no manda esquema estricto; sin token no manda cabecera", async () => {
    const { impl, calls } = fakeFetch(() => ok('```json\n{"headline":"Hola"}\n```'));
    await new OpenAiCompatibleProvider(connection({ jsonMode: "json_object", apiKey: null }), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(1000));
    await new OpenAiCompatibleProvider(connection({ jsonMode: "prompt" }), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(1000));
    expect(JSON.parse(String(calls[0]!.init.body)).response_format).toEqual({ type: "json_object" });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(String(calls[1]!.init.body)).response_format).toBeUndefined();
  });

  it("traduce cada estado HTTP a un resultado estable y dice si vale reintentar", async () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "auth_error", false],
      [403, "auth_error", false],
      [429, "rate_limited", true],
      [503, "provider_error", true],
      [408, "provider_error", true],
      [404, "provider_error", false],
    ];
    for (const [status, outcome, transient] of cases) {
      const { impl } = fakeFetch(() => new Response("x", { status }));
      const error = await new OpenAiCompatibleProvider(connection(), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(1000)).catch((e: unknown) => e);
      expect(error).toMatchObject({ outcome, transient });
    }
  });

  it("una respuesta cortada o sin JSON es salida inválida con los tokens gastados", async () => {
    for (const response of [ok('{"headline":"Ho', "length"), ok("Lo siento, no puedo.")]) {
      const { impl } = fakeFetch(() => response);
      const error = await new OpenAiCompatibleProvider(connection(), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(1000)).catch((e: unknown) => e);
      expect(error).toMatchObject({ outcome: "invalid_output", usage: { inputTokens: 12, outputTokens: 7 } });
    }
  });

  it("si el servidor no responde a tiempo es timeout", async () => {
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const error = await new OpenAiCompatibleProvider(connection(), impl).generate(request as AiRequest<unknown>, AbortSignal.timeout(20)).catch((e: unknown) => e);
    expect(error).toMatchObject({ outcome: "timeout", transient: true });
  });

  it("exige URL base", () => {
    expect(() => new OpenAiCompatibleProvider(connection({ baseUrl: null }))).toThrow(/URL base/);
  });
});

describe("adaptador de Claude (SDK oficial) contra un servidor que imita la Messages API", () => {
  let server: Server;
  let baseUrl: string;
  const received: Array<{ headers: IncomingMessage["headers"]; body: Record<string, unknown> }> = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const message = (text: string, stop_reason = "end_turn") => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 30, output_tokens: 9 },
  });

  const claude = () => new AnthropicProvider(connection({ kind: "ANTHROPIC", baseUrl, model: "claude-opus-5", apiKey: "sk-ant-prueba" }));

  it("manda el esquema en output_config.format y devuelve la salida decodificada con su uso", async () => {
    reply = { status: 200, body: message('{"headline":"Fotos que venden"}') };
    const result = await claude().generate({ ...request, effort: "low" } as AiRequest<unknown>, AbortSignal.timeout(5000));
    expect(result).toEqual({ output: { headline: "Fotos que venden" }, inputTokens: 30, outputTokens: 9, model: "claude-opus-5" });
    const sent = received.at(-1)!;
    expect(sent.headers["x-api-key"]).toBe("sk-ant-prueba");
    expect(sent.body).toMatchObject({ model: "claude-opus-5", max_tokens: 200, system: "Eres redactor.", output_config: { effort: "low", format: { type: "json_schema" } } });
  });

  it("una negativa del modelo pasa a la siguiente conexión; 429 y 529 se reintentan; 401 no", async () => {
    reply = { status: 200, body: message("", "refusal") };
    await expect(claude().generate(request as AiRequest<unknown>, AbortSignal.timeout(5000))).rejects.toMatchObject({ outcome: "refused", transient: false });

    const error = (type: string, status: number) => ({ status, body: { type: "error", error: { type, message: "x" } } });
    reply = error("rate_limit_error", 429);
    await expect(claude().generate(request as AiRequest<unknown>, AbortSignal.timeout(5000))).rejects.toMatchObject({ outcome: "rate_limited", transient: true });
    reply = error("overloaded_error", 529);
    await expect(claude().generate(request as AiRequest<unknown>, AbortSignal.timeout(5000))).rejects.toMatchObject({ outcome: "provider_error", transient: true });
    reply = error("authentication_error", 401);
    await expect(claude().generate(request as AiRequest<unknown>, AbortSignal.timeout(5000))).rejects.toMatchObject({ outcome: "auth_error", transient: false });
  });
});
