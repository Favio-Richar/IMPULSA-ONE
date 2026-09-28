import Anthropic from "@anthropic-ai/sdk";
import { extractJson, toJsonSchema } from "../json.js";
import { AiProviderError, type AIProvider, type AiConnectionConfig, type AiProviderResult, type AiRequest } from "../types.js";

/**
 * Adaptador de Claude con el SDK oficial y salida estructurada (`output_config.format`): el modelo
 * queda obligado al esquema. Se usa `messages.create` y no `messages.parse` a propósito: `parse`
 * intenta decodificar antes de que se pueda mirar `stop_reason`, y una negativa (texto vacío)
 * llegaría como error de formato en vez de como negativa. La validación con Zod, los reintentos y
 * el respaldo los maneja el ejecutor común (`runWithFallback`), igual que para cualquier proveedor,
 * así que el SDK va con `maxRetries: 0`.
 */
export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;

  constructor(private readonly connection: AiConnectionConfig) {
    this.client = new Anthropic({
      apiKey: connection.apiKey ?? undefined,
      ...(connection.baseUrl ? { baseURL: connection.baseUrl } : {}),
      maxRetries: 0,
      timeout: connection.timeoutMs,
    });
  }

  async generate(request: AiRequest<unknown>, signal: AbortSignal): Promise<AiProviderResult> {
    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.connection.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: {
            format: { type: "json_schema", schema: toJsonSchema(request.schema) },
            ...(request.effort ? { effort: request.effort } : {}),
          },
        },
        { signal },
      );
    } catch (error) {
      throw toProviderError(error, signal);
    }

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal") {
      // No es transitorio: el mismo pedido al mismo modelo vuelve a negarse. Pasa a la siguiente conexión.
      throw new AiProviderError("refused", false, "El modelo declinó responder.", usage);
    }
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const output = response.stop_reason === "max_tokens" ? undefined : extractJson(text);
    if (output === undefined) {
      throw new AiProviderError("invalid_output", true, "La respuesta se cortó o no trae un JSON válido.", usage);
    }
    return { output, ...usage, model: response.model };
  }
}

function toProviderError(error: unknown, signal: AbortSignal): AiProviderError {
  if (signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError("timeout", true, "Claude no respondió a tiempo.");
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError("auth_error", false, "Claude rechazó la credencial.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError("rate_limited", true, "Claude pidió esperar (429).");
  }
  if (error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError("provider_error", true, "Claude no está disponible en este momento.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError("provider_error", false, `Claude rechazó el pedido (${error.status ?? "sin estado"}).`);
  }
  return new AiProviderError("provider_error", true, error instanceof Error ? error.message : String(error));
}
