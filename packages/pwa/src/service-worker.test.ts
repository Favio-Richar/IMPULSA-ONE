import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildServiceWorker } from "./service-worker.js";

// F10.5 — el service worker se ejecuta aquí en un entorno simulado: lo que importa es lo que NUNCA hace (cachear API, sesiones,
// peticiones de escritura o de otros orígenes) y que una versión nueva no se active sola.

type Handler = (event: unknown) => void;

function setup(options: { network?: (url: string) => Response | Promise<Response> } = {}) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const flags = { skipWaiting: 0, claimed: 0 };

  const keyOf = (input: string | Request) => (typeof input === "string" ? new URL(input, "https://impulza.test").toString() : input.url);
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      add: async (input: string | Request) => {
        const url = keyOf(input);
        fetched.push(url);
        store.set(url, await (options.network ?? (() => new Response("offline")))(url));
      },
      match: async (input: string | Request) => store.get(keyOf(input)),
      put: async (input: string | Request, response: Response) => void store.set(keyOf(input), response),
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: string | Request) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(input));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const network = async (input: Request | string) => {
    const url = keyOf(input);
    fetched.push(url);
    return (options.network ?? (() => new Response("ok")))(url);
  };
  const self = {
    location: { origin: "https://impulza.test" },
    addEventListener: (type: string, handler: Handler) => void handlers.set(type, handler),
    skipWaiting: () => void (flags.skipWaiting += 1),
    clients: { claim: async () => void (flags.claimed += 1) },
  };
  // En un navegador, una ruta relativa se resuelve contra el origen del service worker.
  class SwRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "https://impulza.test").toString() : input, init);
    }
  }
  runInNewContext(buildServiceWorker({ version: "v1" }), { self, caches, fetch: network, Request: SwRequest, Response, URL });

  /** Dispara un evento `fetch`; devuelve la respuesta si el service worker decidió atender la petición. */
  async function dispatchFetch(request: Request): Promise<Response | "ignored"> {
    let responded: Promise<Response> | null = null;
    handlers.get("fetch")!({ request, respondWith: (value: Promise<Response>) => void (responded = value) });
    return responded ? await responded : "ignored";
  }
  async function lifecycle(type: "install" | "activate"): Promise<void> {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)!({ waitUntil: (value: Promise<unknown>) => void waits.push(value) });
    await Promise.all(waits);
  }
  return { handlers, stores, fetched, flags, caches, dispatchFetch, lifecycle };
}

const page = (path: string, init: RequestInit & { navigate?: boolean } = {}) => {
  const request = new Request(`https://impulza.test${path}`, init);
  if (init.navigate) Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

describe("service worker (F10.5)", () => {
  it("al instalarse guarda la pantalla sin conexión y NO se activa solo", async () => {
    const sw = setup();
    await sw.lifecycle("install");
    expect(sw.stores.get("impulza-static-v1")?.has("https://impulza.test/offline.html")).toBe(true);
    expect(sw.flags.skipWaiting).toBe(0);
  });

  it("solo salta la espera cuando la persona acepta actualizar", async () => {
    const sw = setup();
    sw.handlers.get("message")!({ data: { type: "OTRA_COSA" } });
    expect(sw.flags.skipWaiting).toBe(0);
    sw.handlers.get("message")!({ data: { type: "SKIP_WAITING" } });
    expect(sw.flags.skipWaiting).toBe(1);
  });

  it("nunca atiende la API, otros orígenes ni peticiones que no son GET", async () => {
    const sw = setup();
    expect(await sw.dispatchFetch(page("/api/v1/me"))).toBe("ignored");
    expect(await sw.dispatchFetch(page("/api/members/verify", { method: "POST", body: "{}" }))).toBe("ignored");
    expect(await sw.dispatchFetch(new Request("https://api.impulza.test/api/v1/organizations"))).toBe("ignored");
    expect(await sw.dispatchFetch(new Request("https://media.example/foto.jpg"))).toBe("ignored");
    expect(await sw.dispatchFetch(page("/_next/static/chunk.js", { method: "PUT", body: "x" }))).toBe("ignored");
    expect(await sw.dispatchFetch(page("/sw.js"))).toBe("ignored");
    // Un GET cualquiera que no es estático tampoco se atiende ni se guarda.
    expect(await sw.dispatchFetch(page("/reserva/token-secreto"))).toBe("ignored");
    expect([...sw.stores.values()].every((store) => ![...store.keys()].some((key) => key.includes("/api/") || key.includes("token-secreto")))).toBe(true);
  });

  it("las páginas van a la red y no se guardan; sin red se muestra la pantalla sin conexión", async () => {
    let online = true;
    const sw = setup({ network: (url) => (url.endsWith("/offline.html") ? new Response("SIN CONEXION") : online ? new Response("PAGINA CON DATOS") : Promise.reject(new TypeError("offline"))) });
    await sw.lifecycle("install");

    const live = await sw.dispatchFetch(page("/sitios", { navigate: true }));
    expect(live).not.toBe("ignored");
    expect(await (live as Response).text()).toBe("PAGINA CON DATOS");
    // La página con datos nunca llegó a la caché.
    expect([...sw.stores.get("impulza-static-v1")!.keys()]).toEqual(["https://impulza.test/offline.html"]);

    online = false;
    const offline = await sw.dispatchFetch(page("/sitios", { navigate: true }));
    expect(await (offline as Response).text()).toBe("SIN CONEXION");
  });

  it("los archivos estáticos con huella se guardan y después salen de la caché", async () => {
    const sw = setup();
    await sw.lifecycle("install");
    const first = await sw.dispatchFetch(page("/_next/static/chunks/app-abc123.js"));
    expect(first).not.toBe("ignored");
    const callsAfterFirst = sw.fetched.filter((url) => url.endsWith("app-abc123.js")).length;
    expect(callsAfterFirst).toBe(1);
    expect(sw.stores.get("impulza-static-v1")!.has("https://impulza.test/_next/static/chunks/app-abc123.js")).toBe(true);

    await sw.dispatchFetch(page("/_next/static/chunks/app-abc123.js"));
    expect(sw.fetched.filter((url) => url.endsWith("app-abc123.js"))).toHaveLength(1);
  });

  it("no guarda respuestas con cookies ni errores", async () => {
    const headers = new Headers({ "set-cookie": "sid=1" });
    const sw = setup({ network: (url) => (url.includes("cookie") ? new Response("x", { headers }) : url.includes("missing") ? new Response("nope", { status: 404 }) : new Response("ok")) });
    await sw.lifecycle("install");
    await sw.dispatchFetch(page("/_next/static/cookie.js"));
    await sw.dispatchFetch(page("/_next/static/missing.js"));
    const keys = [...sw.stores.get("impulza-static-v1")!.keys()];
    expect(keys.some((key) => key.includes("cookie.js") || key.includes("missing.js"))).toBe(false);
  });

  it("al activarse retira solo las cachés anteriores propias", async () => {
    const sw = setup();
    sw.stores.set("impulza-static-v0", new Map());
    sw.stores.set("otra-app-cache", new Map());
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    expect([...sw.stores.keys()].sort()).toEqual(["impulza-static-v1", "otra-app-cache"]);
    expect(sw.flags.claimed).toBe(1);
  });
});
