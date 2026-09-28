import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import type { AIProvider, AiConnectionConfig } from "./types.js";

/** Fábrica real: un adaptador por tipo de conexión. Las pruebas la reemplazan por una falsa. */
export function createProvider(connection: AiConnectionConfig): AIProvider {
  switch (connection.kind) {
    case "OPENAI_COMPATIBLE":
      return new OpenAiCompatibleProvider(connection);
    case "ANTHROPIC":
      return new AnthropicProvider(connection);
  }
}
