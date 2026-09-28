# ADR-010: IA con proveedores intercambiables, modelos locales primero

- **Estado:** Aceptado
- **Fecha:** 2026-09-28
- **Fuente:** ST §13 ("sin dependencia rígida con OpenAI, Anthropic o cualquier proveedor") y el
  chat con Favio del 2026-09-27/28: "puede ser no solo Anthropic… Gemini o modelos locales… la idea
  es que aguante modelos locales, a futuro armaré mi propio servidor para alojar modelos y no
  depender de pagos", y "esa administración sería del sistema mío, del dueño; desde ahí se
  administrarían las conexiones".

## Contexto

Fase 6 suma funciones de IA (textos, SEO, traducción, lectura de métricas). El propietario quiere
poder usar modelos de pago en la nube **y** modelos abiertos alojados en un servidor propio, y
cambiar entre ellos sin desplegar. Los servidores de modelos locales más usados (Ollama, vLLM,
llama.cpp, LM Studio) y buena parte de los proveedores en la nube (OpenAI, Gemini, Groq, Together,
DeepSeek, Mistral, OpenRouter) exponen la misma API HTTP "compatible con OpenAI"
(`POST {base}/chat/completions`). Claude usa su propia Messages API.

## Decisión

1. Paquete `packages/ai` (`@impulza/ai`) con la interfaz `AIProvider` y **dos adaptadores**:
   - `OPENAI_COMPATIBLE`, HTTP directo (`fetch`), configurable con URL base, modelo y token. Es el
     adaptador principal: cubre el servidor local del propietario y la mayoría de la nube,
     incluido Gemini por su endpoint compatible.
   - `ANTHROPIC`, con el SDK oficial `@anthropic-ai/sdk` y salida estructurada
     (`output_config.format`).
   Un proveedor nuevo con API compatible no requiere código; uno con API propia es un adaptador más.
2. **Toda salida es JSON validado con Zod** en el servidor, venga del modelo que venga. Al
   proveedor se le pide el esquema (JSON Schema estricto, `json_object` o solo instrucción, según
   lo que soporte la conexión) y una respuesta que no cumple es un error controlado
   (`invalid_output`), nunca se muestra cruda.
3. **Ruteo por tarea con respaldo**: cada tarea (`short_copy`, `seo`, `translate`, `insights`)
   tiene una lista ordenada de conexiones; si la primera falla por un error transitorio o de
   formato, se intenta la siguiente. Sin conexiones activas para una tarea, la función responde
   "no disponible" (503) y nada más se rompe.
4. **Configuración en la base, administrada por el propietario** desde `apps/admin` (F6.2b), no en
   variables de entorno: conexiones (`AiConnection`) y rutas (`AiRoute`) son de plataforma, sin
   `organizationId` — igual que el catálogo de planes y temas. Los tokens se guardan cifrados con
   AES-256-GCM (la misma clave de datos en reposo, `AUTH_ENCRYPTION_KEY`) y nunca vuelven a salir
   completos por la API.
5. **Registro de uso sin contenido** (`AiUsage`): organización, tarea, conexión, modelo, tokens,
   costo estimado, duración y resultado técnico. Nunca el prompt ni la respuesta (ADR-004). El
   costo sale del precio por millón de tokens de cada conexión (0 para modelos locales).
6. **Cuota mensual por plan** (`aiRequestsPerMonth`) y límite de tasa por usuario, comprobados
   antes de llamar a cualquier proveedor.

## Alternativas consideradas

- **Variables de entorno por proveedor**: descartado como fuente principal. Cambiar de modelo o
  apuntar al servidor propio obligaría a redesplegar, justo lo que el propietario quiere evitar.
- **Un adaptador nativo por proveedor (OpenAI, Gemini, Groq…)**: más código que mantener para APIs
  que ya son compatibles entre sí. Se agrega un nativo solo cuando uno aporta algo que el
  compatible no da (como Claude).
- **Una librería de orquestación (LangChain, Vercel AI SDK)**: dependencia grande para cuatro
  llamadas de una sola vuelta; oculta los detalles que acá importan (validación, costo, respaldo,
  registro sin contenido).
- **Llamar a los modelos desde el navegador**: descartado. Expondría tokens y permitiría saltarse
  cuotas; la IA solo se llama desde `apps/api`.

## Consecuencias

- Positivas: el propietario puede operar con costo de API cero usando su servidor; cambiar de
  modelo o proveedor es un cambio de datos; la calidad mínima (esquema) y la seguridad no dependen
  del modelo.
- Negativas: los modelos locales pequeños siguen peor las instrucciones que los grandes; se
  compensa con salida forzada por esquema, validación y reintento, pero la calidad del texto depende
  del modelo que se elija. El servidor de IA propio es infraestructura que hay que asegurar.
- Seguimiento: revisar si una tarea necesita conversación de varias vueltas, herramientas o
  streaming hacia el navegador (hoy son llamadas de una sola vuelta).

## Restricciones asociadas

- Ningún código fuera de `packages/ai` llama a un proveedor de IA directamente.
- La IA propone y el usuario confirma: ninguna respuesta de IA se publica ni se guarda en un bloque
  sin una acción explícita del usuario (ST §13).
- El servidor de modelos del propietario no se expone a internet: solo `apps/api` le habla, por red
  privada o VPN y con token. Su URL la configura solo un superadministrador.
- Los prompts no llevan datos personales de contactos ni secretos; solo contenido de la página y
  métricas agregadas.
