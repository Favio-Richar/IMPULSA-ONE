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
| — | Proveedor de IA y su costo | Generación real de textos | `AIProvider` con adaptador de Anthropic (Claude) configurable por entorno y un adaptador falso para pruebas. Sin clave configurada, el asistente responde "no disponible" (503) y nada más se rompe — mismo criterio que el proveedor de correo en F5.6 |

## Estado

| Historia | Estado |
|---|---|
| F6.1 — Salud de página | Lista para tu revisión (capturas en `docs/design/capturas/f61/`) |
| F6.2 — `AIProvider`, registro de uso y cuota por plan | Pendiente |
| F6.3 — Asistente de textos: títulos, CTA, SEO y traducción | Pendiente |
| F6.4 — IA comercial: lectura de métricas y recomendaciones | Pendiente |
| F6.5 — Pruebas A/B | Pendiente |
| F6.6 — Smart CTA | Pendiente |
| F6.7 — Automatizaciones básicas | Pendiente |
| F6.8 — Modo agencia | Bloqueado (decisión #8) |
| F6.9 — Marca blanca | Bloqueado (decisión #8) |
| F6.10 — Aislamiento y seguridad de Fase 6 | En progreso (caso de F6.1 agregado; se completa con cada historia) |

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

### F6.2 — `AIProvider`, registro de uso y cuota por plan
**Criterios de aceptación:**
- Interfaz `AIProvider` (texto estructurado con esquema Zod de salida) en un paquete propio, con
  adaptador de Anthropic y adaptador falso determinista. El proveedor y el modelo se eligen por
  variables de entorno validadas al iniciar; sin clave, el módulo queda deshabilitado.
- Timeout, reintentos con retroceso solo en errores transitorios, y respuesta validada con Zod:
  una salida que no cumple el esquema es un error controlado, nunca se muestra cruda.
- Tabla `AiUsage` por organización: proveedor, modelo, función, tokens de entrada y salida,
  costo estimado, duración, resultado técnico (ok/timeout/invalid_output/provider_error). Nunca
  guarda el texto del prompt ni la respuesta (ADR-004: minimización).
- Cuota mensual de solicitudes por plan (`Plan.aiRequestsPerMonth`), comprobada antes de llamar
  al proveedor; 402/429 con código estable al superarla. Límite de tasa por usuario.
- Los prompts no incluyen datos personales de contactos ni secretos.

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
