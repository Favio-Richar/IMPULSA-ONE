import { extractJson, formatInstruction, toJsonSchema } from "../json.js";
import { AiProviderError, type AIProvider, type AiConnectionConfig, type AiProviderResult, type AiRequest } from "../types.js";

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** `http://host:11434/v1/` → `http://host:11434/v1`. */
function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Adaptador para la API "compatible con OpenAI" (`POST /chat/completions`). Es el principal
 * (ADR-010): el mismo código habla con el servidor propio de modelos (Ollama, vLLM, LM Studio) y
 * con la mayoría de los proveedores en la nube. Solo `fetch`: sin SDK de un proveedor concreto.
 */
export class OpenAiCompatibleProvider implements AIProvider {
  constructor(
    private readonly connection: AiConnectionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!connection.baseUrl) {
      throw new Error("Una conexión compatible con OpenAI necesita URL base.");
    }
  }

  async generate(request: AiRequest<unknown>, signal: AbortSignal): Promise<AiProviderResult> {
    const { connection } = this;
    const body: Record<string, unknown> = {
      model: connection.model,
      messages: [
        { role: "system", content: `${request.system}\n\n${formatInstruction(request.schema)}` },
        { role: "user", content: request.prompt },
      ],
      max_tokens: request.maxOutputTokens,
      temperature: 0.4,
    };
    if (connection.jsonMode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: request.schemaName, schema: toJsonSchema(request.schema), strict: true },
      };
    } else if (connection.jsonMode === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(connection.baseUrl!), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        // Nunca seguir redirecciones: la URL la fijó un superadministrador y no debe desviarse.
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) {
        throw new AiProviderError("timeout", true, "El proveedor no respondió a tiempo.");
      }
      throw new AiProviderError("provider_error", true, `No se pudo conectar: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw errorForStatus(response.status);
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new AiProviderError("provider_error", true, "La respuesta del proveedor no es JSON.");
    }

    const usage = { inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 };
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new AiProviderError("invalid_output", true, "La respuesta se cortó por largo.", usage);
    }
    const output = typeof choice?.message?.content === "string" ? extractJson(choice.message.content) : undefined;
    if (output === undefined) {
      throw new AiProviderError("invalid_output", true, "La respuesta no trae un JSON válido.", usage);
    }
    return { output, ...usage, model: payload.model ?? connection.model };
  }
}

function errorForStatus(status: number): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError("auth_error", false, `El proveedor rechazó la credencial (${status}).`);
  }
  if (status === 429) {
    return new AiProviderError("rate_limited", true, "El proveedor pidió esperar (429).");
  }
  if (status === 408 || status >= 500) {
    return new AiProviderError("provider_error", true, `Error del proveedor (${status}).`);
  }
  // 400/404/422: el pedido o el modelo no sirven para esta conexión; reintentar no cambia nada.
  return new AiProviderError("provider_error", false, `El proveedor rechazó el pedido (${status}).`);
}
