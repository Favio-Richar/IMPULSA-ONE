# ADR-029 — Versión 2: membresías y cursos, wallet y tarjeta digital, PWA y marketplace

- **Estado:** Aceptado (2026-10-11). Origen: instrucción explícita de Favio de construir el sistema completo,
  dejando solo las credenciales de proveedores para el final.
- **Fuente:** `PLAN_MAESTRO…` §9.3 (Monetización), §19 (Versión 2), §7.6 (Marketplace de integraciones);
  `ST §12` (marketplace de checkout diferido).
- **Contexto:** las Fases 0 a 9 cubren la versión 1 y, dentro de la versión 2 del plan, ya están IA contextual, Smart CTA,
  pruebas A/B, salud de página, automatizaciones avanzadas y marca blanca. Quedan cuatro líneas: membresías y cursos, wallet
  y tarjeta digital, PWA y marketplace.

## Decisiones

### 1. Principio de construcción: sin credenciales, con adaptadores
Igual que en las fases anteriores, todo proveedor externo entra por un contrato/adaptador con su estado «sin configurar» y un
adaptador de prueba que corre en CI. Las credenciales reales (Mercado Pago, certificados de Apple, cuenta de Google Wallet,
correo con dominio verificado) las pone el propietario al final y activan lo ya construido; no condicionan el desarrollo.

### 2. Membresías y contenido protegido
- **Quién es «miembro»:** una persona sin cuenta de panel que accede al contenido protegido de **un sitio** de una organización.
  Identidad por correo con **enlace mágico** (sin contraseña, token de un solo uso con vencimiento, solo su hash guardado).
  Nunca comparte sesión ni permisos con los usuarios del panel (`User`/`Membership`): modelo propio (`SiteMember`).
- **Planes de membresía** (`MembershipPlan`) por organización, con periodicidad y precio en la unidad mínima de la moneda
  (ST §8). El acceso se decide **en el servidor** por la vigencia de la suscripción del miembro; el frontend nunca decide.
- **Cobro:** por la cuenta de Mercado Pago **del propio negocio** (ADR-013). Impulza no custodia fondos ni cobra comisión por
  el dinero de terceros (regla dura de CLAUDE.md). La renovación es un job idempotente con proveedor simulado en CI.

### 3. Cursos
Curso → módulos → lecciones (texto enriquecido saneado, video por enlace/incrustado permitido, archivo protegido). Progreso por
miembro. Acceso por membresía o por compra única (reusa catálogo y pedidos de la Fase 5). Sin alojar video propio: se reutiliza
el proveedor de medios ya integrado y los incrustados de la lista permitida (ADR-018).

### 4. Wallet y tarjeta digital
Tarjeta digital pública (nombre, cargo, contactos, QR) con descarga **vCard** y enlace a una página del sitio. Pase de
**Google Wallet** (JWT firmado) y de **Apple Wallet** (`.pkpass` firmado) detrás de un adaptador `WalletPassProvider`: sin
certificados responde «no disponible» con claridad y la tarjeta + vCard siguen funcionando. Los datos del pase salen solo de la
organización dueña de la tarjeta.

### 5. PWA
Manifiesto e instalación para el **panel** y la **página pública**; service worker acotado: cachea solo recursos estáticos y
una pantalla sin conexión. **Nunca** cachea respuestas de API con datos de organización ni de sesión (riesgo de fuga entre
cuentas en un dispositivo compartido). Notificaciones push quedan fuera hasta que las métricas lo justifiquen.

### 6. Marketplace
**Marketplace de integraciones y plantillas** (plan §7.6): directorio de integraciones y de plantillas de socios, con
instalación en la organización, revisión previa por superadministración y retirada reversible. **No** es un marketplace de
compraventa entre terceros: el checkout de clientes con KYC, tributación, reembolsos y contracargos sigue diferido (ST §12) y
queda prohibido custodiar dinero de terceros (CLAUDE.md). Lo gratuito se instala directo; lo de pago, cuando exista, cobrará
el socio en su propia cuenta y no por Impulza.

## Consecuencias
- Cuatro módulos nuevos de la API con su modelo, migración reversible, contratos, OpenAPI y pruebas de aislamiento (ADR-002).
- El miembro de sitio es una superficie pública nueva con su propio riesgo (enlaces mágicos, contenido de pago): entra a la
  revisión de amenazas de la Fase 10 (F10.7).
- Plan: nuevos límites (`memberships`, `courses`, `walletCards`) y permisos (`membership.manage`, `course.manage`,
  `marketplace.install`) en el catálogo de roles.

## Alternativas descartadas
- **Reutilizar `User` para los miembros:** mezclaría el acceso al panel con el de contenido; un fallo de permisos daría
  acceso al panel. Se descarta.
- **Cobrar y repartir dinero en el marketplace:** viola la regla de no custodiar dinero de terceros. Diferido.
- **Service worker con caché de API:** riesgo de datos cruzados entre cuentas. Descartado.
