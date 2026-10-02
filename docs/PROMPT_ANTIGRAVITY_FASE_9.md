# Prompt para Antigravity — Fase 9: Marca y agencias

Copia el bloque de abajo tal cual. Claude revisa cada historia al terminar.

---

Trabajas en **Impulza One** (monorepo pnpm + Turborepo, NestJS + Next.js + Prisma + PostgreSQL). Vas a
desarrollar la **Fase 9: Marca y agencias**, **una historia a la vez y en orden** (F9.1 → F9.10).

**Antes de escribir código, lee en este orden:**
1. `CLAUDE.md` (reglas duras) y `docs/CONTINUIDAD.md` (estado y trampas técnicas ya encontradas).
2. `docs/decisions/ADR-028-agencias-marca-blanca-y-marca-configurable.md` (el modelo; no lo reabras) y
   `ADR-002-multi-tenancy.md`.
3. `docs/BACKLOG_FASE_9.md`: **reglas transversales** y los criterios de la historia que vas a hacer.
4. El código existente del área (módulos de la API, pantallas del panel y de `apps/admin`) y **reutiliza**
   lo que ya hay (medios, dominios, auditoría, colas BullMQ, correo, guards). No dupliques.

**Qué se espera del producto:** que el **dueño del sistema** y **cada usuario** configuren su marca
(logo, colores, datos) desde la interfaz, y que una **agencia** administre clientes con acceso delegado,
marca blanca y reportes. Diseño **idéntico** al resto del producto (mismos tokens, fondo claro, sobrio),
lógica avanzada y **segura**: permisos en el servidor, aislamiento entre organizaciones, validación Zod,
auditoría, límite de tasa.

**Reglas que NO puedes saltarte** (en la Fase 8 se incumplieron y Claude tuvo que corregirlas):
- **No marques nada como hecho** sin: pruebas unitarias, e2e de la API, **Playwright en móvil y
  escritorio con capturas** en `docs/design/capturas/f9x/`, y cada prueba nueva **verificada contra el
  código roto**.
- `typecheck` y `lint` limpios **no bastan**. Corre `pnpm turbo run typecheck lint test --continue`
  **escribiendo a un archivo de log** (nunca cortes `pnpm turbo` con `Select-Object -First`), el
  `next build` real y la suite de Playwright de tu historia.
- Si tocas la API, **regenera OpenAPI** (`pnpm --filter @impulza/api run openapi:generate`). Si repites una
  lista entre `packages/contracts` y `packages/validation`, agrega una prueba que las compare.
- **No toques archivos ajenos a tu historia**, no hagas `push --force`, no borres documentación ni
  trabajo existente, no ejecutes migraciones destructivas. Migraciones reversibles, con respaldo.
- **Sin librerías nuevas** sin ADR. Sin credenciales: cada integración externa debe tener su estado
  «sin configurar» y un respaldo; el sistema se desarrolla sin ellas.
- Actualiza `docs/BACKLOG_FASE_9.md` **solo con «En revisión»**, nunca «Hecho». **Claude decide** si
  cumple la Definición de Terminado.
- Un commit por historia: `feat(<area>): … (F9.X, ADR-028)`.
- En Windows `pnpm` puede no estar en el PATH: ver `docs/CONTINUIDAD.md` y las trampas de los servidores
  de desarrollo (la API con `vite-node --watch` se cae tras varias ediciones: reiníciala).

**Entrega al terminar cada historia:** resumen de lo hecho, comandos que corriste con su resultado real,
**lo que NO probaste**, y las capturas. Si algo contradice un documento, **detente y avisa** antes de
implementar.

**Empieza por F9.1.**
