import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, request as apiRequest } from "@playwright/test";
import { ADMIN_SESSION_PATH } from "../../global-setup.js";
import { API_BASE_URL } from "../../playwright.config.js";

const CSRF = { "X-Requested-With": "impulza-one" };

/** Respuesta del modelo según el nombre del esquema pedido (`schemaName` de la API). */
export type ModelReplies = Record<string, () => unknown>;

/**
 * Modelo de IA simulado para las pruebas de interfaz (F6.3, F6.4): un servidor local que imita
 * `POST /v1/chat/completions` de un servidor compatible con OpenAI (el mismo camino que un Ollama
 * propio) y una conexión real creada por la administración, puesta en las rutas de las tareas
 * pedidas. La API lo llama de verdad. `stop()` restaura las rutas que había y borra la conexión.
 */
export async function startSimulatedModel(name: string, tasks: string[], replies: ModelReplies): Promise<{ stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { response_format?: { json_schema?: { name?: string } } };
      const reply = replies[body.response_format?.json_schema?.name ?? ""];
      const output = reply ? reply() : { ok: true };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "simulado", choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 80 } }));
    });
  });
  const baseUrl = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));

  const api = await apiRequest.newContext({ storageState: ADMIN_SESSION_PATH, extraHTTPHeaders: CSRF });
  // Restos de una corrida cortada a la mitad.
  const list = (await (await api.get(`${API_BASE_URL}/admin/ai/connections`)).json()) as Array<{ id: string; name: string }>;
  for (const leftover of list.filter((connection) => connection.name === name)) {
    await api.delete(`${API_BASE_URL}/admin/ai/connections/${leftover.id}`);
  }
  const savedRoutes = ((await (await api.get(`${API_BASE_URL}/admin/ai/routes`)).json()) as { routes: Record<string, string[]> }).routes;
  const created = await api.post(`${API_BASE_URL}/admin/ai/connections`, {
    data: { name, kind: "OPENAI_COMPATIBLE", baseUrl, model: "simulado", jsonMode: "json_schema", timeoutMs: 5_000 },
  });
  expect(created.status()).toBe(201);
  const connectionId = ((await created.json()) as { id: string }).id;
  const routes = { ...savedRoutes, ...Object.fromEntries(tasks.map((task) => [task, [connectionId]])) };
  expect((await api.put(`${API_BASE_URL}/admin/ai/routes`, { data: { routes } })).status()).toBe(200);

  return {
    stop: async () => {
      const kept = Object.fromEntries(Object.entries(savedRoutes).map(([task, ids]) => [task, ids.filter((id) => id !== connectionId)]));
      await api.put(`${API_BASE_URL}/admin/ai/routes`, { data: { routes: kept } });
      await api.delete(`${API_BASE_URL}/admin/ai/connections/${connectionId}`);
      await api.dispose();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
