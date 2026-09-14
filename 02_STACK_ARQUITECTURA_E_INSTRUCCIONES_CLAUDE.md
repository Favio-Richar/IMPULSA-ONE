# 02 — Stack, arquitectura e instrucciones de desarrollo

## Proyecto: Impulza One

**Estado del nombre:** nombre de trabajo seleccionado para iniciar el proyecto. Antes de registrar marca, comprar dominio o publicar comercialmente, realizar búsqueda formal de marca y disponibilidad de dominios.

**Empresa impulsora:** Visionary Group / Favidev  
**Categoría:** plataforma SaaS multi-tenant de identidad digital, captación de clientes y ventas.  
**Propuesta:** convertir la audiencia de redes sociales en contactos, reservas, cotizaciones y ventas desde un centro digital configurable.

---

# 1. Instrucción principal para Claude

Claude debe utilizar este archivo junto con los otros documentos del proyecto como fuente oficial de requisitos.

Antes de programar:

1. Leer completamente todos los archivos `.md` de la carpeta `/docs` o raíz documental.
2. Crear un resumen de requisitos, restricciones, dependencias y decisiones pendientes.
3. Inspeccionar el repositorio completo si ya existe código.
4. Identificar tecnologías, versiones, variables de entorno, migraciones y cambios existentes.
5. No borrar, sustituir ni reescribir código funcional sin una razón técnica comprobable.
6. No comenzar módulos posteriores antes de completar y validar la fase activa.
7. No inventar funcionalidades contrarias a los documentos.
8. Preguntar solamente cuando una decisión faltante cambie materialmente el modelo de datos, la seguridad, los pagos o el alcance.

## Orden de autoridad documental

Si existe contradicción, aplicar este orden:

1. Instrucción más reciente y explícita del propietario.
2. Este documento técnico.
3. Plan maestro funcional de páginas y módulos.
4. Bocetos, referencias visuales y documentos anteriores.

Cuando haya una contradicción, Claude debe informarla antes de implementar, indicar los archivos afectados y proponer una resolución concreta.

---

# 2. Resultado que debe construirse

Impulza One no es un clon de Linktree ni HeyLink. Debe ser una plataforma propia que permita a profesionales, comercios, negocios de servicios, creadores y agencias:

- Crear un sitio público móvil y responsive desde una URL única.
- Incorporar páginas internas además del perfil principal.
- Publicar enlaces, servicios, productos, contenido y llamadas a la acción.
- Captar contactos y administrarlos en un mini-CRM.
- Recibir solicitudes, cotizaciones y reservas.
- Medir visitas, clics, contactos y conversiones.
- Generar enlaces cortos y códigos QR.
- Usar dominio personalizado.
- Trabajar en equipo con permisos.
- Gestionar varias cuentas mediante un modo agencia.
- Recibir sugerencias de IA sin ceder el control de publicación.

El producto debe percibirse como un **centro digital de negocio**, no como una simple lista de botones.

---

# 3. Principios obligatorios de arquitectura

## 3.1 Monolito modular primero

Construir inicialmente un monolito modular con aplicaciones desplegables separadas dentro de un monorepo:

- Web pública y marketing.
- Panel del cliente.
- API.
- Workers.
- Superadministración.

No crear microservicios en el MVP. Cada dominio debe estar desacoplado internamente para permitir extracción futura cuando exista una necesidad real de escala.

## 3.2 Multi-tenancy desde el inicio

Todo dato comercial debe pertenecer a una organización o workspace.

Reglas:

- Un usuario puede pertenecer a varias organizaciones.
- Una organización puede administrar varias marcas o sitios según su plan.
- Toda consulta protegida debe filtrar por `organization_id`.
- Nunca confiar en un `organization_id` enviado por el navegador sin verificar membresía.
- Los superadministradores deben usar rutas, permisos y auditoría independientes.
- Las pruebas deben comprobar que una organización no pueda leer o modificar datos de otra.

## 3.3 Separación de responsabilidades

- Next.js presenta la experiencia web y consume la API.
- NestJS contiene reglas de negocio, permisos e integraciones.
- PostgreSQL mantiene datos transaccionales.
- Redis mantiene caché, rate limits, estados efímeros y colas.
- BullMQ procesa trabajos asincrónicos.
- S3/R2 almacena archivos.
- Los proveedores externos se conectan mediante adaptadores.

## 3.4 Diseño preparado para reemplazar proveedores

Crear contratos internos para:

- Pagos.
- Emails.
- Almacenamiento.
- Inteligencia artificial.
- Analítica externa.
- Calendarios.
- WhatsApp.

Ninguna regla central debe depender directamente de un proveedor concreto.

---

# 4. Stack tecnológico oficial

Usar versiones estables y compatibles. Registrar las versiones exactas elegidas en el `package.json`, lockfile, imágenes Docker y documento de arquitectura. No actualizar dependencias mayores automáticamente.

## 4.1 Base del monorepo

| Área | Elección oficial |
|---|---|
| Lenguaje | TypeScript estricto |
| Runtime | Node.js 24 LTS |
| Gestor | pnpm workspaces |
| Monorepo | Turborepo |
| Repositorio | GitHub |
| CI/CD | GitHub Actions |
| Contenedores | Docker + Docker Compose |

## 4.2 Frontend

| Necesidad | Herramienta |
|---|---|
| Framework | Next.js con App Router |
| UI | React |
| Estilos | Tailwind CSS |
| Primitivas accesibles | Radix UI |
| Base de componentes | shadcn/ui adaptado |
| Validación | Zod |
| Formularios | React Hook Form |
| Datos remotos | TanStack Query |
| Tablas | TanStack Table |
| Estado del editor | Zustand |
| Drag and drop | dnd-kit |
| Editor enriquecido | Tiptap |
| Gráficos | Recharts |
| Fechas | date-fns |
| Animaciones | Motion |
| Iconos | Lucide |
| Catálogo UI | Storybook |

No copiar estilos predeterminados de shadcn sin adaptación. Construir un sistema visual propio de Impulza One.

## 4.3 Backend

| Necesidad | Herramienta |
|---|---|
| Framework | NestJS |
| Contrato API | REST versionada `/api/v1` |
| Documentación | OpenAPI/Swagger |
| Validación | Zod y pipes/adaptadores de NestJS |
| Base de datos | PostgreSQL 18 |
| ORM y migraciones | Prisma |
| Caché/efímero | Redis |
| Colas | BullMQ |
| Tiempo real | WebSocket/SSE solo cuando sea necesario |

No implementar GraphQL en el MVP. No mezclar lógica crítica en controladores. Usar controller, application service/use case, domain y repository/adapters cuando corresponda.

## 4.4 Servicios e infraestructura

| Necesidad | Elección inicial |
|---|---|
| Archivos | Cloudflare R2 o S3 compatible |
| Desarrollo de archivos | MinIO opcional |
| CDN/DNS/WAF | Cloudflare |
| Email | Resend o Amazon SES mediante adaptador |
| Plantillas email | React Email |
| Errores | Sentry |
| Telemetría | OpenTelemetry |
| Métricas | Prometheus + Grafana |
| Logs | Loki o servicio equivalente |
| Disponibilidad | Uptime Kuma |
| Reverse proxy | Caddy, Traefik o Nginx documentado |
| Servidor inicial | VPS Linux con Docker Compose |

Elegir un solo proveedor por categoría para el primer despliegue. No integrar varias alternativas simultáneamente.

## 4.5 Calidad

| Prueba | Herramienta |
|---|---|
| Unitarias | Vitest |
| Integración backend | Vitest + Supertest |
| Componentes | Testing Library |
| End-to-end | Playwright |
| Accesibilidad | axe integrado con Playwright |
| Carga | k6 |
| API manual | Bruno o Postman |
| Lint | ESLint |
| Formato | Prettier |
| Hooks | Husky + lint-staged |

---

# 5. Estructura obligatoria del repositorio

```text
impulza-one/
├── apps/
│   ├── web/                    # Marketing, SEO y páginas públicas
│   ├── dashboard/              # Panel de usuario y agencia
│   ├── admin/                  # Superadministración
│   ├── api/                    # NestJS REST API
│   └── worker/                 # BullMQ workers
├── packages/
│   ├── ui/                     # Design system compartido
│   ├── database/               # Prisma, migraciones y seeds
│   ├── auth/                   # Contratos y utilidades de autenticación
│   ├── validation/             # Esquemas Zod compartidos
│   ├── contracts/              # DTO y contratos API
│   ├── analytics/              # Taxonomía y utilidades de eventos
│   ├── config/                 # Configuración validada
│   ├── observability/          # Logs, tracing y errores
│   ├── eslint-config/
│   └── tsconfig/
├── infrastructure/
│   ├── docker/
│   ├── proxy/
│   ├── monitoring/
│   └── scripts/
├── docs/
│   ├── decisions/              # ADRs
│   ├── api/
│   ├── architecture/
│   └── runbooks/
├── .github/workflows/
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

El sitio público y el dashboard pueden comenzar dentro de una sola aplicación Next.js si eso acelera el MVP. Si se toma esa decisión, documentarla en un ADR y preservar la separación por rutas, layouts y dominios.

---

# 6. Módulos de dominio

## 6.1 Núcleo del MVP

1. `auth`
2. `users`
3. `organizations`
4. `memberships`
5. `plans`
6. `subscriptions`
7. `sites`
8. `pages`
9. `blocks`
10. `themes`
11. `templates`
12. `media`
13. `forms`
14. `contacts`
15. `analytics`
16. `domains`
17. `short-links`
18. `qr-codes`
19. `notifications`
20. `audit`
21. `admin`

## 6.2 Versión posterior al MVP

1. `bookings`
2. `services`
3. `catalog`
4. `products`
5. `orders`
6. `payments`
7. `campaigns`
8. `email-marketing`
9. `automations`
10. `integrations`
11. `ai-assistant`
12. `agency`
13. `white-label`
14. `courses`
15. `memberships-commerce`

No crear tablas vacías o módulos ficticios de la segunda lista durante el MVP. Diseñar puntos de extensión y construirlos cuando corresponda.

---

# 7. Autenticación y autorización

Utilizar Better Auth/Auth.js o una solución equivalente aprobada, integrada con PostgreSQL.

Funciones mínimas:

- Registro con email y contraseña.
- Verificación de correo.
- Inicio con Google opcional.
- Recuperación de contraseña.
- Cierre de sesiones.
- Sesiones/dispositivos activos.
- 2FA antes de producción comercial.
- Rate limiting.
- Bloqueo temporal por intentos abusivos.

## Roles iniciales

- `OWNER`
- `ADMIN`
- `EDITOR`
- `ANALYST`
- `SUPPORT`
- `AGENCY_MANAGER`
- `SUPER_ADMIN`

Implementar RBAC con permisos explícitos. Preparar el modelo para restricciones por recurso. Cada endpoint debe declarar autenticación, organización y permiso requerido.

---

# 8. Datos y persistencia

## Reglas de PostgreSQL

- UUID para identificadores expuestos.
- Timestamps en UTC.
- Dinero almacenado en enteros de unidad mínima más código ISO de moneda.
- Claves foráneas y restricciones reales.
- Índices basados en consultas previstas.
- `created_at`, `updated_at` y auditoría cuando corresponda.
- Soft delete solamente para recursos recuperables; no aplicarlo universalmente.
- Slugs únicos según su alcance.
- Datos del constructor versionados de forma recuperable.
- Transacciones para operaciones comerciales de varios pasos.

## Entidades base esperadas

```text
User
Session
Account
Organization
Membership
Role
Permission
Plan
Subscription
UsageCounter
Site
SiteDomain
Page
PageVersion
Block
BlockVersion
Theme
Template
MediaAsset
Form
FormField
FormSubmission
Contact
ContactEvent
ShortLink
QrCode
AnalyticsEvent
AnalyticsAggregate
Notification
AuditLog
FeatureFlag
```

Claude debe producir primero un ERD y una explicación de cardinalidades antes de crear la migración inicial.

---

# 9. Constructor visual

El constructor es el núcleo del producto.

## Requisitos

- Bloques tipados, no HTML arbitrario.
- Esquema de configuración versionado por tipo de bloque.
- Drag and drop con teclado y puntero.
- Vista previa móvil, tablet y escritorio.
- Guardado automático con indicador de estado.
- Borrador y versión publicada separadas.
- Deshacer y rehacer.
- Duplicar, ocultar, programar y eliminar.
- Orden persistente.
- Validación del bloque antes de publicar.
- Historial de versiones y restauración.
- Render público seguro.
- Caché invalidada únicamente al publicar.

## Bloques del MVP

- Perfil.
- Encabezado/hero.
- Texto.
- Enlace/botón.
- Redes sociales.
- Imagen.
- Galería.
- Video embebido.
- WhatsApp.
- Email y llamada.
- Formulario de contacto.
- Servicio destacado.
- Separador.
- Preguntas frecuentes.
- Testimonios.

No permitir scripts personalizados en el MVP.

---

# 10. Analítica

## Taxonomía inicial

- `page_view`
- `block_view`
- `block_click`
- `social_click`
- `whatsapp_click`
- `form_start`
- `form_submit`
- `lead_created`
- `share_click`
- `qr_visit`

## Flujo

```text
Navegador
→ endpoint de eventos
→ validación y rate limit
→ cola Redis/BullMQ
→ worker de procesamiento
→ evento controlado
→ agregados de PostgreSQL
→ dashboard
```

Reglas:

- No guardar datos personales innecesarios.
- Documentar retención.
- Anonimizar o truncar identificadores técnicos cuando corresponda.
- Evitar escrituras sin límite desde bots.
- Idempotencia para eventos críticos.
- Diferenciar visitas humanas de tráfico sospechoso.
- ClickHouse se evaluará solo cuando PostgreSQL deje de cumplir los objetivos medidos.

---

# 11. Archivos

- Almacenamiento privado compatible con S3.
- Subida mediante URL firmada.
- Validación de MIME real y extensión.
- Tamaño máximo por tipo y plan.
- Procesamiento asincrónico.
- Imágenes WebP/AVIF y miniaturas.
- Texto alternativo obligatorio o advertido.
- Eliminación segura de huérfanos.
- CDN para contenido público.
- Nunca exponer credenciales S3 al cliente.

---

# 12. Pagos

Separar dos contextos:

1. Suscripción del propietario a Impulza One.
2. Pagos de visitantes a los clientes de Impulza One.

## MVP

- Plan gratuito y límites de uso.
- Modelo interno de planes y suscripciones.
- Enlaces externos de pago configurables.
- No custodiar ni distribuir dinero de terceros.

## Después del MVP

- Integrar cobro recurrente del SaaS con un proveedor compatible con Chile.
- Implementar webhooks firmados e idempotentes.
- Guardar referencias del proveedor, nunca datos completos de tarjetas.
- Diseñar reintentos, morosidad, cancelaciones y periodos de gracia.

## Fase avanzada

- Evaluar checkout de clientes y marketplace solamente después de definir responsabilidades legales, tributarias, KYC, reembolsos, contracargos y distribución de fondos.

---

# 13. IA

Crear una interfaz `AIProvider` y adaptadores independientes.

Funciones autorizadas inicialmente:

- Proponer estructura de página.
- Escribir títulos, descripciones y CTA.
- Generar metadata SEO.
- Traducir contenido.
- Analizar métricas agregadas.
- Recomendar mejoras.

Reglas:

- La IA no publica cambios importantes automáticamente.
- El usuario ve una vista previa y confirma.
- Registrar proveedor, modelo, tokens, costo y resultado técnico.
- No incluir secretos ni datos personales sin necesidad.
- Límites por organización y plan.
- Timeouts, reintentos y fallback controlado.
- No crear dependencia rígida con OpenAI, Anthropic o cualquier proveedor.

---

# 14. Diseño y experiencia

## Dirección visual obligatoria

- Fondo general blanco o muy claro.
- Estilo profesional, moderno, elegante y comercial.
- Tipografía clara y de buena escala.
- Iconos lineales.
- Sombras discretas.
- Bordes moderados.
- Nada excesivamente redondo.
- Evitar paneles hechos solo de tarjetas grandes.
- Priorizar tablas, listas, editores y superficies funcionales.
- CTA visibles.
- Vista previa como protagonista del constructor.
- Responsive real.
- Objetivo WCAG 2.2 AA.

No copiar la interfaz visual de Linktree, HeyLink, Beacons o Stan. Las referencias sirven para comprender funciones y patrones, no para reproducir propiedad visual.

## Estados obligatorios

- Cargando.
- Vacío.
- Datos completos.
- Sin resultados.
- Error recuperable.
- Sin permisos.
- Límite de plan.
- Desconectado.
- Éxito.
- Móvil.

---

# 15. Seguridad mínima obligatoria

Aplicar desde el primer commit:

- Variables de entorno validadas al iniciar.
- Secretos fuera del repositorio.
- Hash seguro de contraseñas.
- Cookies `HttpOnly`, `Secure` y política SameSite adecuada.
- CSRF donde corresponda.
- CORS restrictivo.
- CSP y cabeceras de seguridad.
- Rate limiting por IP, usuario y organización.
- Validación del servidor para toda entrada.
- Sanitización de contenido enriquecido.
- Prevención de XSS, SQL injection, SSRF y open redirects.
- URLs externas validadas.
- Protección de endpoints de subida.
- Webhooks firmados.
- Idempotencia en pagos y trabajos importantes.
- Registro de auditoría.
- Dependencias examinadas en CI.
- Respaldos cifrados y prueba de restauración.

Crear threat model antes de pagos, dominio personalizado, subida de archivos y scripts de terceros.

---

# 16. Observabilidad

Toda aplicación debe producir:

- Logs JSON estructurados.
- `request_id` o `trace_id`.
- Métricas de latencia y errores.
- Endpoint de salud.
- Trazas OpenTelemetry.
- Reporte a Sentry sin secretos.

Workers:

- Métricas de trabajos completados, fallidos y reintentados.
- Dead-letter strategy.
- Panel o herramientas para reintento controlado.
- Idempotencia.

No registrar contraseñas, tokens, cookies, números completos de documentos ni payloads sensibles.

---

# 17. Entornos

Definir:

- `local`
- `test`
- `staging`
- `production`

Cada entorno debe tener base de datos, Redis, buckets, claves y dominios separados. Nunca probar migraciones nuevas directamente en producción.

Archivos requeridos:

- `.env.example` sin secretos.
- Validación tipada de configuración.
- `docker-compose.yml` para desarrollo.
- configuración de staging.
- configuración de producción.
- runbook de despliegue.
- runbook de restauración.

---

# 18. CI/CD

Cada pull request debe ejecutar:

1. Instalación reproducible con lockfile.
2. Lint.
3. Comprobación TypeScript.
4. Pruebas unitarias.
5. Pruebas de integración relevantes.
6. Build de aplicaciones afectadas.
7. Auditoría de dependencias.
8. Verificación de migraciones.

Pipeline de despliegue:

```text
Pull request
→ revisión
→ merge protegido
→ build de imagen inmutable
→ staging
→ smoke tests
→ migración controlada
→ producción
→ health check
→ rollback si falla
```

No construir código diferente en producción. Desplegar la misma imagen validada en staging.

---

# 19. Fases de desarrollo

## Fase 0 — Preparación

- Leer documentación.
- Auditar repositorio.
- Crear mapa de requisitos.
- Registrar decisiones pendientes.
- Confirmar alcance exacto del MVP.
- Crear ADR inicial.
- Configurar monorepo, CI y entornos.

## Fase 1 — Fundación

- Design system.
- Configuración tipada.
- Base de datos.
- Autenticación.
- Organizaciones y membresías.
- Roles y permisos.
- Auditoría.
- Layouts del panel.

## Fase 2 — Sitio público y constructor

- Sitios.
- Páginas.
- Bloques.
- Temas.
- Borrador/publicación.
- Historial.
- Render público.
- Slugs.
- SEO base.

## Fase 3 — Conversión

- Formularios.
- Contactos.
- WhatsApp.
- QR.
- Enlaces cortos.
- Eventos analíticos.
- Dashboard de conversión.

## Fase 4 — SaaS comercial

- Planes.
- Límites.
- Suscripción.
- Administración global.
- Soporte mínimo.
- Dominios personalizados.
- Producción y monitoreo.

## Fase 5 — Negocio digital

- Servicios.
- Reservas.
- Catálogo.
- Productos digitales.
- Pedidos.
- Pagos de negocios.
- Campañas.

## Fase 6 — Diferenciación

- Asistente IA.
- Smart CTA.
- Pruebas A/B.
- Salud de página.
- Modo agencia.
- Marca blanca.
- Automatizaciones.

Una fase no está terminada porque “la pantalla se ve”. Debe cumplir definición de terminado.

---

# 20. Primera tarea concreta para Claude

Al recibir estos documentos, Claude debe hacer lo siguiente, en este orden:

1. Listar todos los documentos recibidos.
2. Leerlos completamente.
3. Inspeccionar el repositorio sin modificar archivos.
4. Crear `docs/REQUIREMENTS_TRACEABILITY.md` con requisitos agrupados y su fuente.
5. Crear `docs/architecture/ARCHITECTURE.md` con diagrama de componentes y decisiones.
6. Crear `docs/architecture/ERD.md` con entidades, atributos críticos y cardinalidades.
7. Crear `docs/decisions/ADR-001-modular-monolith.md`.
8. Crear `docs/decisions/ADR-002-multi-tenancy.md`.
9. Proponer backlog de Fase 0 y Fase 1 con criterios de aceptación.
10. Mostrar el plan y archivos que se modificarán.
11. Esperar aprobación antes de realizar una inicialización destructiva o reemplazar una estructura existente.
12. Tras la aprobación, crear la fundación del monorepo.

Si el repositorio está vacío, puede proponer los comandos de inicialización, pero debe conservar este documento y los demás archivos entregados.

---

# 21. Definición de terminado

Una historia o módulo se considera terminado solamente si:

- Cumple criterios de aceptación.
- Tiene validación del servidor.
- Aplica permisos multi-tenant.
- Incluye estados de carga, vacío, error y éxito.
- Es responsive cuando tiene UI.
- Incluye pruebas relevantes.
- No genera errores de TypeScript, lint o build.
- Actualiza OpenAPI si modifica la API.
- Incluye migración si cambia datos.
- Incluye telemetría adecuada.
- Actualiza documentación.
- No expone secretos ni datos sensibles.
- Fue probado en staging cuando afecta despliegue.

---

# 22. Restricciones explícitas

Claude no debe:

- Copiar marca, textos o diseño exacto de competidores.
- Empezar con microservicios.
- Introducir Kubernetes o Kafka en el MVP.
- Usar MongoDB como base principal.
- Implementar GraphQL sin decisión posterior.
- Permitir HTML o JavaScript arbitrario en páginas públicas.
- Confiar en permisos del frontend.
- Mezclar datos entre organizaciones.
- Almacenar tarjetas o credenciales de terceros.
- Publicar cambios de IA sin confirmación.
- Borrar documentación o trabajo existente.
- Ejecutar migraciones destructivas sin respaldo y aprobación.
- agregar dependencias sin justificar su propósito.
- marcar una fase como completa sin pruebas y verificación.

---

# 23. Convenciones iniciales

- Código y nombres técnicos en inglés.
- Interfaz inicial en español, preparada para i18n.
- Commits pequeños y descriptivos.
- Conventional Commits.
- Ramas por funcionalidad o flujo definido por el propietario.
- DTO y esquemas compartidos sin duplicación innecesaria.
- Errores de dominio con códigos estables.
- Fechas guardadas en UTC y mostradas según zona del usuario.
- Acciones destructivas con confirmación y, cuando sea posible, recuperación.

---

# 24. Identidad del producto centralizada

No repetir valores de marca directamente en componentes. Crear configuración central:

```ts
export const product = {
  name: "Impulza One",
  shortName: "Impulza",
  company: "Visionary Group",
  description:
    "Tu negocio completo en un solo enlace: presenta tu marca, capta clientes, agenda, vende y mide resultados.",
} as const;
```

Logos, colores, favicon, emails, metadata y textos legales deben consumir configuración central. Esto permitirá cambiar el nombre antes del lanzamiento sin una reescritura.

---

# 25. Entregables esperados del MVP

- Sitio comercial.
- Registro, acceso y recuperación.
- Onboarding guiado.
- Dashboard.
- Constructor visual.
- Página pública responsive.
- Bloques esenciales.
- Temas y plantillas.
- Formularios.
- Mini-CRM de contactos.
- Analítica básica.
- QR y enlaces cortos.
- Planes y límites.
- Panel administrativo mínimo.
- Despliegue staging/producción.
- Respaldos, monitoreo y documentación.

## Métrica principal del MVP

Un nuevo usuario debe poder registrarse, crear una página profesional, publicarla y recibir un primer contacto desde redes sociales sin asistencia técnica.

---

# 26. Comando inicial para Claude

Usar este mensaje junto con los documentos:

> Lee completamente todos los archivos Markdown entregados para el proyecto Impulza One. No programes todavía. Primero inspecciona el repositorio, consolida requisitos, detecta contradicciones y genera la arquitectura, ERD, ADRs y backlog indicados en `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md`. Respeta el orden de fases, el monolito modular, el aislamiento multi-tenant, el stack oficial y las restricciones de seguridad. Muéstrame el diagnóstico y el plan de archivos antes de inicializar o modificar la base del proyecto.

---

# 27. Nota sobre el nombre

**Impulza One** es el nombre de trabajo recomendado porque comunica avance comercial y admite enlaces, reservas, CRM, ventas, campañas e IA sin limitar la marca a una sola función.

La búsqueda web preliminar no reemplaza:

- Consulta formal de marca en INAPI.
- Revisión de dominios `.cl` y `.com`.
- Revisión de nombres en redes sociales.
- Revisión legal internacional si el producto se expande.

No publicar ni registrar activos hasta completar estas comprobaciones.
