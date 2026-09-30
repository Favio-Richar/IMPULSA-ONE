# Architecture Decision Records — Impulza One

## Cuándo escribir un ADR

Cuando una decisión es **estructural y cara de revertir**: elección de stack, modelo de
multi-tenancy, estrategia de autenticación, proveedor externo core (pagos, email, storage),
cambio de un patrón ya aceptado en otro ADR. No hace falta un ADR para decisiones locales a un
módulo, nombres de variables, o elecciones reversibles en minutos.

Regla práctica: si la respuesta a "¿esto obligaría a reescribir trabajo ya hecho si nos
equivocamos?" es sí, es un ADR.

## Proceso

1. Copiar `TEMPLATE.md` a `ADR-NNN-titulo-en-kebab-case.md`, con `NNN` correlativo de tres dígitos
   (revisar el último ADR existente en esta carpeta).
2. Llenar Contexto → Decisión → Alternativas → Consecuencias. Estado inicial: `Propuesto`.
3. El propietario (Favio) aprueba explícitamente antes de implementar — un ADR en estado
   `Propuesto` no autoriza a construir sobre esa decisión.
4. Al aprobarse, cambiar el estado a `Aceptado` en el mismo commit que agrega el ADR (o en uno
   inmediatamente posterior si la aprobación llegó por otro canal).
5. Un ADR aceptado **no se edita para cambiar la decisión** — si la decisión cambia, se crea un
   ADR nuevo que la reemplaza y se actualiza el estado del viejo a
   `Reemplazado por ADR-NNN`. El historial de decisiones debe quedar legible, no reescrito.

## No reabrir sin razón técnica nueva

Por instrucción explícita de `CLAUDE.md`: los ADRs ya aceptados (ADR-001, ADR-002) no se
cuestionan en cada tarea nueva. Solo se reabren cuando aparece evidencia técnica concreta que no
existía al momento de decidir (p. ej. un módulo saturando recursos compartidos, medido — no
especulado). Reabrir significa proponer un ADR nuevo, no editar el existente.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [ADR-001](./ADR-001-modular-monolith.md) | Monolito modular sobre microservicios para el MVP | Aceptado |
| [ADR-002](./ADR-002-multi-tenancy.md) | Multi-tenancy estricto por organización desde el primer commit | Aceptado |
| [ADR-003](./ADR-003-playwright-e2e.md) | Usar Playwright para las pruebas de interfaz de extremo a extremo | Aceptado |
| [ADR-004](./ADR-004-privacidad-retencion-datos.md) | Privacidad y retención de datos para conversión y analítica (Ley 21.719) | Aceptado |
| [ADR-005](./ADR-005-superadministracion.md) | Modelo de superadministrador | Aceptado |
| [ADR-006](./ADR-006-almacenamiento-medios.md) | Almacenamiento y entrega de medios (Cloudflare R2) | Aceptado |
| [ADR-007](./ADR-007-procesamiento-video.md) | Procesamiento de video propio con ffmpeg | Aceptado |
| [ADR-008](./ADR-008-direccion-visual-link-in-bio.md) | Adoptar el patrón visual de las apps de enlace en bio para la página pública | Aceptado |
| [ADR-009](./ADR-009-three-js-sitio-comercial.md) | Usar three.js para gráficos 3D, solo en el sitio comercial | Aceptado |
| [ADR-010](./ADR-010-proveedores-ia.md) | IA con proveedores intercambiables, modelos locales primero | Aceptado |
| [ADR-011](./ADR-011-pruebas-ab.md) | Pruebas A/B con reparto en el servidor y variante calculada por la API | Aceptado |
| [ADR-012](./ADR-012-cobro-suscripciones-chile.md) | Cobro de suscripciones con Webpay Oneclick y Mercado Pago, con cumplimiento de consumo chileno | Aceptado |
| [ADR-013](./ADR-013-cobros-de-los-negocios.md) | Los negocios cobran a sus clientes con su propia cuenta de Mercado Pago conectada | Aceptado |
