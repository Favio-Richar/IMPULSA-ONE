import { AiProviderError, type AIProvider, type AiProviderResult, type AiRequest } from "../types.js";

/** Lo que devuelve el proveedor falso en cada llamada: una salida o un error controlado. */
export type FakeStep = { output: unknown; inputTokens?: number; outputTokens?: number } | AiProviderError;

/**
 * Proveedor determinista para pruebas: sin red, sin claves, sin costo. Responde en orden lo que se
 * le encoló y, sin nada encolado, falla como un proveedor caído. Guarda cada pedido para que las
 * pruebas verifiquen qué se le mandó al modelo (p. ej. que no viajen datos personales).
 */
export class FakeProvider implements AIProvider {
  readonly requests: Array<AiRequest<unknown>> = [];
  private readonly steps: FakeStep[];

  constructor(steps: FakeStep[] = [], private readonly model = "fake-model") {
    this.steps = [...steps];
  }

  enqueue(...steps: FakeStep[]): void {
    this.steps.push(...steps);
  }

  async generate(request: AiRequest<unknown>): Promise<AiProviderResult> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) {
      throw new AiProviderError("provider_error", true, "Proveedor falso sin respuestas encoladas.");
    }
    if (step instanceof AiProviderError) {
      throw step;
    }
    return { output: step.output, inputTokens: step.inputTokens ?? 100, outputTokens: step.outputTokens ?? 50, model: this.model };
  }
}
