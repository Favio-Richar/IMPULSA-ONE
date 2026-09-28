# Backlog — Fase 6 (Diferenciación)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19 (Fase 6: asistente IA, Smart CTA,
pruebas A/B, salud de página, modo agencia, marca blanca, automatizaciones) y §13 (IA: interfaz
`AIProvider` con adaptadores, la IA propone y el usuario confirma, registrar proveedor/modelo/
tokens/costo, límites por plan, sin dependencia rígida de un proveedor),
`PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §9.16 (asistente IA), §11 (modo agencia y marca
blanca), §14.2 (Smart CTA), §14.6 (A/B), §14.7 (salud de página), §14.8 (IA comercial) y ADR-004
(privacidad). Cada historia usa la Definición de Terminado general (`CLAUDE.md`) **más** los
criterios de abajo.

Precondición: Fase 5 completa salvo lo bloqueado por la decisión #6 (cobros). Favio pidió el
2026-09-27 seguir ("continúa en la fase que quedaste, debemos terminar el sistema"), igual que el
2026-09-26 ("si terminas una fase debes seguir con la siguiente").

## Decisiones de negocio que rozan esta fase

| # | Decisión | Qué bloquea | Cómo se avanza mientras tanto |
|---|---|---|---|
| 8 | Alcance inicial de agencia | Modo agencia (F6.8) y marca blanca (F6.9) | No se construyen hasta que Favio defina el alcance: son las dos historias que cambian el modelo de cuentas (una organización que administra a otras) y la facturación |
| 4 | Límites exactos de cada plan | Cuota de uso de IA y de pruebas A/B por plan | Límites como en Fase 4: columnas del `Plan` con valores por defecto conservadores, editables desde administración sin desplegar |
| — | Proveedor de IA y su costo | Generación real de textos | **Resuelta 2026-09-28 (ADR-010):** proveedores intercambiables con modelos locales primero (servidor propio de Favio a futuro); conexiones administradas por el propietario en `apps/admin`. Sin conexiones configuradas, el asistente responde "no disponible" (503) y nada más se rompe |

## Estado

| Historia | Estado |
|---|---|
| F6.1 — Salud de página | Lista para tu revisión (capturas en `docs/design/capturas/f61/`) |
| F6.2 — Motor de IA: `AIProvider`, ruteo con respaldo, registro de uso y cuota por plan | Lista para tu revisión (sin UI: la administración es F6.2b) |
| F6.2b — Conexiones de IA en la superadministración | Pendiente |
| F6.3 — Asistente de textos: títulos, CTA, SEO y traducción | Pendiente |
| F6.4 — IA comercial: lectura de métricas y recomendaciones | Pendiente |
| F6.5 — Pruebas A/B | Pendiente |
| F6.6 — Smart CTA | Pendiente |
| F6.7 — Automatizaciones básicas | Pendiente |
| F6.8 — Modo agencia | Bloqueado (decisión #8) |
| F6.9 — Marca blanca | Bloqueado (decisión #8) |
| F6.10 — Aislamiento y seguridad de Fase 6 | En progreso (casos de F6.1 y F6.2 agregados; se completa con cada historia) |

### Bitácora de avance (para retomar)

- **2026-09-27 — Backlog creado.** Orden: F6.1 → F6.2 → F6.3 → F6.4 → F6.5 → F6.6 → F6.7, y
  F6.10 se va completando con cada historia. F6.1 va primero porque no depende de ningún
  proveedor y es la base de "detectar información faltante" del asistente (F6.4).

- **2026-09-27 — F6.1 terminada**, en "Lista para tu revisión".
  - `packages/validation/src/health`: `evaluatePageHealth`, función pura con 21 códigos estables
    en 7 categorías y 3 severidades (crítico −24, advertencia −8, sugerencia −2; piso 0). Reusa
    `parseStoredBlock`, `findImagesWithoutAlt`, `seoMetaSchema` y `themeTokensSchema` en vez de
    repetir reglas. Solo cuenta lo que el visitante ve (bloques visibles y dentro de su programación).
  - API: `GET organizations/:org/sites/:site/pages/:page/health` (miembro activo, igual que leer la
    página), `PageHealthService` arma el estado vivo (bloques con su última configuración,
    formularios del sitio, servicios y productos activos, páginas publicadas, tema efectivo, cambios
    sin publicar) y registra un log estructurado con puntaje y conteos, nunca contenido.
    Contrato `pageHealthResponse` en `@impulza/contracts`; OpenAPI regenerado (124 rutas).
  - Panel: indicador en la cabecera del constructor (puntaje + lectura, anunciado a lectores de
    pantalla) que abre un diálogo agrupado por severidad con un botón por hallazgo: abrir el
    bloque, publicar, editar SEO (`#seo` en la página), cambiar tema o ir a la biblioteca. Se
    recalcula solo cuando cambian la página o los bloques. Estados de carga, error con reintento,
    vacío ("en buena forma") y éxito.
  - Sin migración (no cambia el modelo de datos). Sin peticiones salientes a URLs del usuario.
  - Pruebas: validación 15 nuevas (504 en total), panel 3 nuevas, API e2e 4 + caso central de
    aislamiento (verificado contra el código roto: sin el filtro por sitio, el formulario de otra
    organización contaba como configurado y la prueba falla); suite completa de la API 426/426.
    Playwright `salud-pagina.spec.ts` 2/2 (móvil y escritorio: sin desplazamiento horizontal,
    diálogo dentro de la pantalla, "Abrir el bloque" abre el bloque).
  - Siguiente: F6.2 (`AIProvider`, registro de uso y cuota por plan).

- **2026-09-28 — F6.2 terminada**, en "Lista para tu revisión". Decisión en ADR-010 (Favio: "que
  aguante modelos locales… no depender de pagos"; conexiones administradas por el dueño).
  - `packages/ai` (`@impulza/ai`): `AIProvider`, adaptador **compatible con OpenAI** (`fetch`, sin
    seguir redirecciones, modo de JSON por conexión, esquema también en las instrucciones para
    modelos que ignoran `response_format`, extracción tolerante de bloques de código), adaptador
    **Anthropic** con el SDK oficial `@anthropic-ai/sdk` 0.128.0 (salida estructurada por
    `output_config.format`, `maxRetries: 0`, negativa del modelo → siguiente conexión) y
    `runWithFallback` (timeout por conexión, reintento con retroceso solo en transitorios y salida
    inválida, respaldo en orden, validación Zod siempre). La prueba del adaptador de Claude corre
    contra un servidor local que imita la Messages API y encontró un caso real: `messages.parse`
    decodifica antes de mirar `stop_reason`, así que una negativa llegaba como error de formato; se
    cambió a `messages.create` + validación propia.
  - Base (migración aditiva `20260928030000_f62_ai_engine` con `CHECK`s): `AiConnection`, `AiRoute`,
    `AiUsage`; `aiRequestsPerMonth` en los límites del plan (provisorios: 20 / 300 / 1.500 / 5.000,
    decisión #4) y en las pantallas de plan del panel y de la administración.
  - API: `AiService` (única puerta a la IA): ruta por tarea desde la base, token descifrado solo al
    usarse, límite de 20 solicitudes por minuto por usuario (429), cuota mensual con reserva atómica
    en Redis sembrada desde la base (402; una solicitud fallida devuelve el cupo), registro de cada
    intento en `AiUsage` sin contenido y log estructurado con resultados y costo.
    `GET organizations/:org/ai/status` (tareas disponibles y cuota, sin proveedores ni modelos).
    OpenAPI regenerado (125 rutas). Sin UI todavía: la usan F6.2b y F6.3.
  - Pruebas: `@impulza/ai` 14; API e2e 6 (respaldo real desde la base, token descifrado, uso sin
    contenido, 503 sin conexiones, 402 al agotar la cuota sin llamar al proveedor, 429 por usuario,
    estado sin datos internos) — la de concurrencia verificada contra el código roto (contar en la
    base en vez de reservar en Redis deja pasar dos solicitudes con el último cupo); caso central
    de aislamiento (el uso de B no cuenta en la cuota de A). Suite completa de la API 433/433 (una
    primera corrida tuvo 4 fallas de carga en administración y páginas; aisladas pasan 47/47 y la
    segunda corrida completa pasó entera).
  - Sin conexiones configuradas, todo responde "no disponible".
  - Siguiente: F6.2b (conexiones de IA en la superadministración).

---

### F6.1 — Salud de página
**Criterios de aceptación:**
- Función pura (`packages/validation`, isomorfa) que recibe la página con sus bloques, SEO, tema
  y fondo, y devuelve un **puntaje 0–100** y una lista de hallazgos con código estable, severidad
  (`critical`/`warning`/`info`), categoría (SEO, accesibilidad, enlaces, acción, contenido,
  rendimiento) y el bloque afectado si corresponde. Nunca texto libre del usuario en el código.
- Reglas mínimas: sin título/descripción SEO ni contenido del que derivarlos; imágenes sin texto
  alternativo; contraste del tema bajo AA; sin acción principal ni ningún botón de acción; enlaces
  con `http://` o duplicados; bloques que no se pueden mostrar (`invalid_config`, `future_version`);
  formulario sin configurar; reservas o catálogo sin servicios/productos activos; página vacía o
  con demasiados bloques pesados (videos/galerías) para el teléfono; página sin publicar o con
  cambios sin publicar.
- `GET /organizations/:org/sites/:site/pages/:page/health` con `site.read`, calculado en el
  servidor sobre el estado real (el panel no calcula el puntaje por su cuenta).
- Panel: tarjeta "Salud de la página" en el editor con puntaje, hallazgos agrupados por
  severidad y un botón por hallazgo que lleva al bloque o a la pestaña que lo corrige; estados de
  carga/vacío/error/éxito; responsive.
- La comprobación de enlaces es **estática** (formato, esquema, duplicados, páginas internas
  borradas): no se hace ninguna petición saliente a URLs del usuario (SSRF). La verificación en
  vivo de enlaces caídos queda para cuando exista el hosting (F4.8) y un servicio de salida
  aislado.

### F6.2 — Motor de IA: `AIProvider`, ruteo con respaldo, registro de uso y cuota por plan
Decisión en `docs/decisions/ADR-010-proveedores-ia.md`.
**Criterios de aceptación:**
- Paquete `@impulza/ai` con la interfaz `AIProvider` y dos adaptadores: **compatible con OpenAI**
  (URL base + modelo + token: Ollama, vLLM, LM Studio, OpenAI, Gemini, Groq, OpenRouter…) y
  **Anthropic** (SDK oficial). Adaptador falso determinista para pruebas, sin red.
- Salida siempre JSON validado con Zod; modo de formato por conexión (`json_schema`,
  `json_object` o solo instrucción) para servidores que no soportan esquema estricto. Una salida
  inválida es `invalid_output`, se reintenta una vez y luego pasa a la siguiente conexión.
- Timeout por conexión (más largo para modelos locales), reintento con retroceso solo en errores
  transitorios (red, 408/429/5xx) y **ruteo por tarea con respaldo** en el orden configurado.
- Modelo de datos de plataforma (migración aditiva): `AiConnection` (tipo, URL, modelo, token
  cifrado + pista de 4 caracteres, modo de formato, timeout, precio por millón de tokens, activa),
  `AiRoute` (tarea → conexiones en orden) y `AiUsage` (organización, usuario, tarea, conexión,
  modelo, tokens, costo, duración, resultado). `AiUsage` nunca guarda prompt ni respuesta.
- Cuota mensual por plan (`aiRequestsPerMonth` en los límites del plan, con valor por defecto
  conservador) y límite de tasa por usuario, comprobados antes de llamar al proveedor; 429 con
  código estable al superarlos (cuota: 402 `PLAN_LIMIT_REACHED`, igual que el resto de los límites
  de plan de F4.2; tasa por usuario: 429). Una solicitud cuenta una vez aunque haya reintentos o
  respaldo.
- `GET /organizations/:org/ai/status`: si el asistente está disponible y cuánto queda de la cuota
  del mes (para que el panel muestre u oculte las funciones).
- El servidor de IA propio se alcanza solo desde `apps/api`; la URL la fija un superadministrador.

### F6.2b — Conexiones de IA en la superadministración
**Criterios de aceptación:**
- En `apps/admin`, sección "Inteligencia artificial": alta, edición, activación y baja de
  conexiones; el token se escribe pero nunca se vuelve a mostrar (solo la pista); botón "Probar
  conexión" que hace una llamada mínima y muestra resultado y latencia.
- Rutas por tarea con orden de respaldo (arrastrar o subir/bajar); interruptor global.
- Consumo del mes por conexión y por tarea (solicitudes, tokens, costo, fallas) y las
  organizaciones con más uso.
- Solo superadministradores con sesión TOTP; cada cambio queda en la auditoría.

### F6.3 — Asistente de textos: títulos, CTA, SEO y traducción
**Criterios de aceptación:**
- Desde el constructor: proponer título/subtítulo del perfil, texto de un botón, título y
  descripción SEO, y traducir los textos de un bloque a otro idioma. Devuelve 1–3 propuestas.
- **La IA propone; el usuario confirma**: la propuesta se muestra como vista previa lado a lado y
  solo se aplica al bloque (borrador) con un clic explícito; nunca publica.
- Las propuestas pasan por los mismos esquemas del bloque (largo máximo, texto plano) antes de
  mostrarse.

### F6.4 — IA comercial: lectura de métricas y recomendaciones
**Criterios de aceptación:**
- Sobre métricas **agregadas** del sitio (F3.5/F3.6, sin datos personales) y los hallazgos de
  F6.1, la IA explica qué pasa y propone hasta 3 acciones concretas, cada una con su razón.
- Si no hay muestra suficiente, lo dice en vez de inventar una tendencia.

### F6.5 — Pruebas A/B
**Criterios de aceptación:**
- Una prueba compara dos variantes de un bloque de acción (texto/estilo del botón) o del
  encabezado de perfil; reparto estable por visitante anonimizado (ADR-004), sin cookies de
  terceros.
- Métrica: clics de la acción y conversiones registradas. Se recomienda un ganador **solo con
  muestra suficiente** (prueba estadística documentada); antes, "sin resultado todavía".
- Aplicar el ganador es una acción explícita del usuario.

### F6.6 — Smart CTA
**Criterios de aceptación:**
- La acción principal puede cambiar por reglas cerradas: horario del sitio (fuera de horario →
  otro botón), dispositivo, campaña (UTM) y disponibilidad de reservas. Sin geolocalización fina.
- Reglas validadas en servidor, evaluadas en el render público sin romper el caché de la página.

### F6.7 — Automatizaciones básicas
**Criterios de aceptación:**
- Disparador → acción, de un catálogo cerrado: contacto nuevo / reserva creada / pedido creado →
  etiquetar contacto, cambiar estado comercial, avisar al equipo por correo.
- Ejecutadas por cola (worker), idempotentes, con registro por ejecución y auditoría.

### F6.8 — Modo agencia *(bloqueado, decisión #8)*
Dashboard de clientes, cambio rápido entre cuentas, pausa/archivo, duplicación, transferencia,
roles por cliente y módulo, aprobación antes de publicar (PM §11.1–11.3).

### F6.9 — Marca blanca *(bloqueado, decisión #8)*
Logo y colores de la agencia, dominio de agencia, portal del cliente, correos con marca,
plantillas privadas y reportes personalizados (PM §11.4–11.5).

### F6.10 — Aislamiento y seguridad de Fase 6
**Criterios de aceptación:**
- Cada endpoint nuevo suma su caso a `multi-tenant-isolation.e2e.test.ts`.
- La IA nunca recibe datos de otra organización; el registro de uso no guarda prompts ni
  respuestas; las pruebas A/B y el Smart CTA no filtran configuración interna en la respuesta
  pública.
