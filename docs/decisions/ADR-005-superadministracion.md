# ADR-005: Modelo de superadministrador

- **Estado:** Aceptado (aprobado por Favio el 2026-09-24)
- **Fecha:** 2026-09-24
- **Fuente:** `docs/BACKLOG_FASE_4.md` F4.4; ADR-002 §4 (rutas y guards de superadministración
  separados); `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §12 (superadministración);
  `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §7 (roles, 2FA) y §15 (seguridad).

## Contexto

F4.4 necesita que alguien del equipo de Impulza pueda ver el estado global de la plataforma,
cambiar el plan de una organización, bloquearla y editar el catálogo de planes. Es el permiso más
poderoso del sistema: si se filtra, se filtran todas las organizaciones a la vez.

Lo que ya existe y condiciona la decisión:

- ADR-002 §4 exige que las rutas de superadministración sean un módulo aparte, con su propio control
  de acceso y auditoría, que no comparta camino de autorización con las rutas de organización.
- El rol `SUPER_ADMIN` existe en la tabla `roles` desde F1.3, pero los roles se asignan por
  **membresía** (usuario × organización). Un superadministrador no pertenece a una organización:
  usar ese rol en una membresía mezclaría los dos caminos que ADR-002 separa.
- `AuditLog.organizationId` ya es nullable para acciones sin organización (ADR-002 §4).
- 2FA (TOTP) existe desde F1.4 con el secreto cifrado, pero el panel no tiene pantalla para
  activarlo y el login normal no lo exige.

## Decisión

1. **Quién es superadministrador: una marca en la cuenta, no una membresía.** `User.isSuperAdmin`
   (booleano, `false` por defecto). El rol `SUPER_ADMIN` de la tabla `roles` no se usa en
   membresías; `assignable-roles` ya lo excluye y sigue excluyéndolo.

2. **Cómo se otorga: solo desde el servidor, nunca desde la API.** Un script de operación
   (`pnpm --filter @impulza/api run superadmin -- grant <email>` / `revoke <email>`) que corre
   quien tiene acceso a la base de datos. No existe ningún endpoint que otorgue o quite la marca, así
   que un superadministrador comprometido no puede crear otros. El script audita la acción
   (`admin.superadmin_granted` / `admin.superadmin_revoked`, actor `null`, `metadata.via = "cli"`).

3. **2FA obligatorio desde el momento en que se otorga.** Si la cuenta no tiene 2FA, `grant` genera
   el secreto TOTP, lo guarda cifrado, lo deja activo e imprime una sola vez la URL `otpauth://` para
   cargarla en la app autenticadora. Nunca existe un superadministrador sin 2FA, ni un momento en que
   baste la contraseña para enrolar un segundo factor. `revoke` quita la marca y cierra todas sus
   sesiones de administración.

4. **Sesión de administración separada de la sesión del panel.**
   - `Session.scope` (`USER` | `ADMIN`). El login de `apps/admin` (`POST /api/v1/admin/auth/login`)
     exige correo, contraseña **y** código TOTP en la misma petición, y crea una sesión `ADMIN`.
   - Cookie propia `impulza_admin_session`, `HttpOnly`, `SameSite=Strict`, `Secure` en producción,
     con `path=/api/v1/admin`: el navegador ni siquiera la envía a las rutas de organización.
   - Duración corta: 8 horas, sin renovación.
   - `SessionAuthGuard` (panel) rechaza una sesión `ADMIN` y `AdminSessionGuard` rechaza una
     sesión `USER`, aunque alguien copie el identificador de una cookie a la otra. El guard de
     administración vuelve a comprobar `isSuperAdmin` en cada petición: revocar tiene efecto
     inmediato.
   - Mismo mensaje de error si la cuenta no existe, la contraseña falla, el código falla o la
     cuenta no es superadministradora. Los fallos cuentan para el bloqueo por intentos (F1.4) y la
     ruta tiene rate limiting propio.

5. **Qué puede ver: metadatos de la plataforma, no datos comerciales.** Las rutas `/api/v1/admin/*`
   exponen conteos, planes, uso, miembros (correo y rol), sitios (nombre, slug y estado) y la
   auditoría. **No** exponen contactos, envíos de formularios, contenido de páginas ni analítica de
   visitantes de ninguna organización. Si algún día soporte necesita ver datos comerciales, será
   con un flujo explícito de acceso de soporte (consentido por la organización y auditado), que
   requiere un ADR propio. Ver el detalle de una organización también queda auditado
   (`admin.organization_viewed`): nada de acceso silencioso.

   *Precisión (2026-09-29, F4.6d, ADR-012):* los cobros de Impulza a una organización (su
   suscripción, sus pagos, montos y boletas) son datos de la **plataforma**, no datos comerciales
   de la organización: la superadministración los ve (Facturación y detalle de la organización).
   Se muestran solo marca y últimos 4 dígitos de la tarjeta; nunca la referencia de la pasarela.

6. **Bloqueo de organización.** `Organization.status` (`ACTIVE` | `BLOCKED`), con fecha y motivo.
   Bloquear y restaurar exigen un motivo escrito y quedan auditados con el actor real.
   - Superficies públicas: el sitio, sus páginas, formularios, enlaces cortos, QR y eventos de
     analítica responden 404, igual que un sitio que no existe, sin revelar que está bloqueado. Se
     invalida la caché de `apps/web` en el acto.
   - Panel: `OrganizationMembershipGuard` deja pasar lecturas (`GET`/`HEAD`) y rechaza toda
     escritura con `403` y `code: "ORGANIZATION_BLOCKED"`. El panel muestra un aviso permanente.
     La organización puede seguir exportando sus datos (derecho de acceso, ADR-004).

7. **Catálogo de planes editable.** Desde F4.4 la tabla `plans` es la fuente de verdad: el seed crea
   los planes que falten, pero **ya no sobrescribe** uno existente (si no, re-sembrar borraría lo
   editado desde la administración). Los límites se validan con `planLimitsSchema`, y bajar un límite
   por debajo del uso actual se permite: como en F4.2, solo impide crear más, nunca borra.

## Alternativas consideradas

- **Usar el rol `SUPER_ADMIN` en una membresía de una "organización de plataforma".** Descartada:
  reutiliza el camino de autorización de organizaciones, justo lo que ADR-002 §4 prohíbe, y un bug
  en ese camino daría acceso global.
- **Lista de correos superadministradores en una variable de entorno.** Descartada: cambiarla exige
  un deploy, no deja auditoría en la base y un secreto de configuración mal manejado bastaría para
  escalar privilegios.
- **Otorgar desde la propia administración.** Descartada por ahora: un superadministrador
  comprometido podría crear otros. Se puede reconsiderar con aprobación de dos personas.
- **Reutilizar la sesión del panel con 2FA "elevado".** Descartada: mezcla los dos caminos y hace
  que una cookie robada del panel valga para la administración.

## Consecuencias

- Positivo: la administración tiene su propia puerta (cookie, sesión, guard y rutas). Un error en la
  autorización de organizaciones no abre la administración, ni al revés.
- Positivo: toda acción queda en `AuditLog` con actor real, y ver una organización también.
- Negativo: crear el primer superadministrador requiere acceso al servidor. Es intencional.
- Negativo: la administración no puede ayudar con contenido o contactos de un cliente. Queda para el
  flujo de acceso de soporte de un ADR futuro.
- Seguimiento: el login del panel todavía no exige 2FA a las cuentas que lo activaron (deuda de
  F1.4, anterior a este ADR). No se resuelve acá, pero se registra en el backlog.
