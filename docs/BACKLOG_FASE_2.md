# Backlog — Fase 2 (Sitio público y constructor)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19 (lista de Fase 2), `PLAN_MAESTRO_
PLATAFORMA_IDENTIDAD_DIGITAL.md` §9.2/§9.3/§9.4/§9.5/§9.14/§10 y `docs/architecture/ERD.md`
(las entidades de esta fase ya están modeladas ahí desde F0.1). Cada historia usa la Definición de
Terminado general de ST §21 (replicada en `CLAUDE.md`) **más** los criterios específicos de abajo.

Precondición cumplida: Fase 1 cerrada (F1.1–F1.10, ver `BACKLOG_FASE_0_1.md` "Salida de Fase 1").

## Decisiones pendientes que rozan esta fase

De `REQUIREMENTS_TRACEABILITY.md` §15 — ninguna bloquea el núcleo de Fase 2, pero acotan alcance:

- **#3 Segmento principal del MVP** (*"recomendable antes de Fase 2"*): afecta **plantillas** y el
  orden de prioridad de bloques, no el motor. El conjunto de bloques del MVP ya está fijado por
  ST §9 (ver F2.4), así que se avanza sin esta decisión; **las plantillas (`Template`) quedan
  explícitamente fuera del alcance de Fase 2** hasta que el propietario defina el segmento.
- **#7 Cuotas de almacenamiento/tráfico** (*"antes de Fase 4 y Fase 2 (media)"*): por eso la
  **biblioteca multimedia (PM §9.6) queda fuera de Fase 2**. Los bloques de imagen/galería de F2.4
  aceptan una URL externa validada; la subida de archivos propia llega cuando existan las cuotas.

Ambas exclusiones son de alcance, no de calidad: lo que sí entra, entra completo.

## Fase 2 — Sitio público y constructor

**Estado de la fase** (se actualiza al cerrar cada historia contra la Definición de Terminado; una
historia solo pasa a "Terminada" si cumple *todos* los criterios, no solo los visibles):

| Historia | Estado |
|---|---|
| F2.1 — Modelo de datos de sitios, páginas y bloques | Terminada |
| F2.2 — Sitios (CRUD + slug) | Terminada |
| F2.3 — Páginas (CRUD, slug, orden, visibilidad) | Terminada |
| F2.4 — Bloques tipados | Terminada |
| F2.5 — Temas y apariencia | Terminada |
| F2.6 — Borrador, publicación e historial | Terminada |
| F2.7 — Render público (`apps/web`) | Pendiente (siguiente) |
| F2.8 — SEO base | Pendiente |
| F2.9 — Constructor visual (`apps/dashboard`) | Pendiente |
| F2.10 — Aislamiento multi-tenant de Fase 2 | Pendiente (se re-verifica al cerrar la fase) |

> **Deuda saldada el 2026-09-19 — OpenAPI**: el repositorio no publicaba un documento OpenAPI
> (`docs/api/` estaba vacío desde F0.1) pese a que la Definición de Terminado lo exige al modificar
> la API, así que ninguna historia de F1.4 a F2.5 pudo cumplir ese criterio. Cerrado: `docs/api/openapi.json`
> describe las 48 operaciones derivando los esquemas de los mismos Zod que validan las peticiones, y
> `apps/api/src/openapi/openapi.test.ts` hace fallar CI si el documento y la API se separan. Ver
> `README.md` §"Contrato de la API — OpenAPI". **A partir de acá, una historia que toque la API y no
> regenere el documento no pasa CI.**
>
> **Deuda declarada nueva — rate limiting parcial**: `CLAUDE.md` exige "rate limiting por
> IP/usuario/organización" como no negociable, pero `RateLimitGuard` hoy solo está montado en los
> cinco endpoints públicos de `/auth`. Todo el resto de la API —incluidos los endpoints de escritura
> de sitios, páginas y bloques— no tiene límite de peticiones. Se detectó al anotar OpenAPI (el
> decorador de errores compartido documentaba un 429 que ningún guard podía devolver). No es parte
> de F2.6; necesita su propia tarea, con la decisión de si el límite es por IP, por usuario o por
> organización en cada familia de endpoints.
>
> **Deuda declarada nueva — apagado de `RedisModule`**: el cliente de ioredis se provee con una
> factoría suelta, sin gancho de apagado, así que su socket mantiene vivo el bucle de eventos:
> `app.close()` no termina. El generador de OpenAPI lo sortea con un `process.exit(0)` explícito y
> un `TODO` en `apps/api/src/openapi/generate.ts`, pero **el mismo socket colgado afecta al apagado
> del servidor real**, no solo al script. Corresponde a una tarea de apagado ordenado
> (`onApplicationShutdown`), no a este trabajo de documentación.

### F2.1 — Modelo de datos de sitios, páginas y bloques
**Criterios de aceptación:**
- `Site`, `SiteDomain`, `Page`, `PageVersion`, `Block`, `BlockVersion` y `Theme` en
  `packages/database` exactamente según `ERD.md` §"Sitios y contenido" (no se redefine el ERD; si
  algo debe cambiar, se actualiza el ERD y se justifica).
- Toda entidad comercial cuelga de `organization_id` directa o transitivamente (ADR-002).
- Migración aplicada y reversible; `pnpm db:seed` sigue funcionando.
- Índices para las consultas reales del render público (slug de sitio, slug de página por sitio).
- Unicidad garantizada en base de datos, no solo en la aplicación: slug de sitio único global,
  slug de página único por sitio.

### F2.2 — Sitios (CRUD + slug)
**Criterios de aceptación:**
- Crear, leer, listar, actualizar y archivar sitios de la organización activa.
- Slug validado en servidor: formato, largo, minúsculas, sin colisión, y **lista de reservados**
  (`www`, `api`, `admin`, `app`, `panel`, `blog`, `status`, …) que no puede tomar un usuario.
- Cambiar el slug de un sitio publicado deja una redirección registrada (no rompe enlaces vivos).
- Permisos por rol vía el mecanismo declarativo de F1.6; auditoría de creación/cambio/archivado.
- Aislamiento multi-tenant probado.

### F2.3 — Páginas (CRUD, slug, orden, visibilidad)
**Criterios de aceptación:**
- Cada sitio tiene una página de inicio creada automáticamente y no eliminable.
- Slug por página único dentro del sitio, validado en servidor con las mismas reglas que F2.2.
- Orden persistente y reordenable; visibilidad (pública/oculta) independiente del estado de
  publicación.
- Borrar una página deja sus versiones históricas accesibles hasta la purga definida (no se pierde
  trabajo del usuario sin confirmación explícita).

### F2.4 — Bloques tipados
**Criterios de aceptación:**
- **Nunca HTML/JS arbitrario** (restricción dura de ST §22): cada bloque es un `type` conocido con
  su esquema Zod versionado (`config_schema_version`), validado en servidor al guardar.
- Bloques del MVP (ST §9, lista cerrada para esta fase): perfil, hero, texto, enlace/botón, redes,
  imagen, galería, video embebido, WhatsApp, email/llamada, formulario de contacto, servicio
  destacado, separador, FAQ, testimonios.
- El texto enriquecido se sanitiza en servidor con una lista blanca de etiquetas/atributos.
- URLs validadas contra `javascript:`/`data:` y open-redirect; embeds solo de proveedores
  permitidos (lista blanca), nunca un iframe con URL libre.
- Agregar, editar, duplicar, ocultar, eliminar y reordenar; orden persistente.
- Un esquema desconocido o de versión futura no rompe el render — degrada de forma controlada.

### F2.5 — Temas y apariencia
**Criterios de aceptación:**
- `Theme` con tokens (paleta, tipografía, radios, espaciado, densidad) aplicables a un sitio.
- Catálogo de temas base coherentes con la dirección visual obligatoria (fondo claro, sombras
  discretas, bordes moderados, nada excesivamente redondo).
- El usuario elige tokens de un conjunto validado en servidor, **no** CSS libre.
- Todo tema del catálogo cumple contraste WCAG 2.2 AA, verificado por prueba automática (se
  reutiliza el verificador real de `packages/ui` de F1.1).

### F2.6 — Borrador, publicación e historial
**Criterios de aceptación:**
- Borrador y publicado son estados separados: editar nunca altera lo que ve el público hasta
  publicar.
- Publicar crea una `PageVersion` inmutable con el snapshot completo del contenido.
- Historial navegable con autor y fecha; restaurar una versión anterior crea una versión nueva
  (no reescribe la historia).
- Publicación idempotente: publicar dos veces sin cambios no genera versiones basura.
- Auditoría de publicación/restauración con actor real.

### F2.7 — Render público (`apps/web`)
**Criterios de aceptación:**
- Resolución por slug de sitio + slug de página; 404 propio si no existe o no está publicado.
- Renderiza **solo** contenido publicado: un borrador nunca es alcanzable públicamente, ni
  adivinando la URL.
- Sin datos de otras organizaciones en la respuesta ni en el HTML/JSON embebido — probado.
- Caché con invalidación **solo al publicar** (ST §9), no por tiempo arbitrario.
- Responsive real y accesible (WCAG 2.2 AA) en móvil y escritorio.
- Estados de carga/error del propio render resueltos (nunca una página en blanco).

### F2.8 — SEO base
**Criterios de aceptación:**
- Título, descripción, canonical, robots y Open Graph por página, editables y con valores por
  defecto sensatos derivados del contenido.
- `sitemap.xml` y `robots.txt` por sitio, con solo las páginas públicas y publicadas.
- Metadatos escapados correctamente (no hay inyección vía título/descripción).

### F2.9 — Constructor visual (`apps/dashboard`)
**Criterios de aceptación:**
- Distribución de PM §9.2: navegación/biblioteca de bloques, configuración del elemento
  seleccionado, y **vista previa protagonista** (móvil/tablet/escritorio) — no un panel hecho solo
  de tarjetas grandes.
- Arrastrar y soltar (dnd-kit), agregar/editar/duplicar/ocultar/eliminar.
- Deshacer y rehacer.
- Guardado automático con indicador de estado visible y manejo explícito del fallo de guardado
  (nunca se pierde trabajo en silencio).
- Publicar desde el constructor, con diferencia clara entre "guardado" y "publicado".
- Estados de carga, vacío, error y éxito en toda la UI; responsive real.
- Ningún control de negocio confiado al frontend: toda validación se repite en servidor.

### F2.10 — Aislamiento multi-tenant de Fase 2
**Criterios de aceptación:**
- `apps/api/src/multi-tenant-isolation.e2e.test.ts` extendido con cada endpoint nuevo de esta fase
  (sitios, páginas, bloques, temas, publicación, historial).
- Se re-verifica el ataque de id cruzado (id de organización propio + id de recurso ajeno).
- El render público no expone contenido no publicado ni de otra organización.

## Salida de Fase 2

Fase 2 se considera terminada cuando un usuario puede: crear un sitio con su slug, editar su
página de inicio con bloques tipados en el constructor visual, elegir un tema, guardar como
borrador, publicar, ver el resultado en la URL pública con SEO correcto, consultar el historial y
restaurar una versión anterior — todo con aislamiento multi-tenant probado. Recién entonces se
inicia Fase 3 (conversión).
