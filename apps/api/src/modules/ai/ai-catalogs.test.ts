import { AI_JSON_MODES, AI_PROVIDER_KINDS, AI_TASKS } from "@impulza/ai";
import { AI_CONNECTION_JSON_MODES, AI_CONNECTION_KINDS, AI_TASK_CODES } from "@impulza/validation";
import { describe, expect, it } from "vitest";

// `@impulza/validation` repite estas listas porque no puede depender de `@impulza/ai` (trae el SDK
// de un proveedor y no es isomorfo). Esta prueba es la que impide que se separen.
describe("catálogos de IA (F6.2b)", () => {
  it("tareas, tipos de conexión y modos de JSON coinciden entre @impulza/ai y @impulza/validation", () => {
    expect([...AI_TASK_CODES]).toEqual([...AI_TASKS]);
    expect([...AI_CONNECTION_KINDS]).toEqual([...AI_PROVIDER_KINDS]);
    expect([...AI_CONNECTION_JSON_MODES]).toEqual([...AI_JSON_MODES]);
  });
});
