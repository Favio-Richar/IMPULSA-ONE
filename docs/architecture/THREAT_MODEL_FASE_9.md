# Revisión de amenazas — Fase 9 (agencias, marca blanca, reportes y moderación)

**Alcance:** lo construido en F9.1 a F9.9 (ADR-028). **Fecha:** 2026-10-11. **Método:** por cada superficie nueva, quién
podría abusar de ella, qué se hizo para impedirlo y **qué prueba lo demuestra**. Donde no hay prueba o la defensa es parcial,
se dice (sección «Riesgos residuales»). No sustituye una auditoría externa ni una prueba de penetración.

Principio común (ADR-002): el servidor nunca confía en el `organizationId` del cliente. Toda ruta de organización pasa por
`OrganizationMembershipGuard`, y la prueba **«Barrido de TODAS las rutas de organización»**
(`apps/api/src/multi-tenant-isolation.e2e.test.ts`) recorre las ~300 rutas del OpenAPI publicado y exige 403 a quien no es
miembro, en ambos sentidos y con un administrador. Una ruta nueva queda cubierta sin tocar la prueba (verificada contra una
guardia retirada a propósito).

## 1. Suplantación por marca blanca (F9.2, F9.7)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Una agencia usa el nombre/logo de otra organización o de la plataforma para engañar a clientes | El nombre no puede suplantar a la plataforma, a otra marca blanca ni a un negocio ajeno; logos solo del propio espacio de almacenamiento (`branding/org/<id>/`), URLs externas rechazadas | `white-label.e2e.test.ts` («el nombre no puede suplantar…», logos externos), `brand-profile.e2e.test.ts` |
| Correo «de» un dominio que la agencia no controla | `senderEmail` solo de un dominio **verificado** por DNS; aunque lo esté, solo firma lo que lleva el nombre de la agencia; si no, remitente de plataforma | `packages/validation/src/branding/email.test.ts`, `white-label.e2e.test.ts` |
| Correo de marca blanca que oculta quién lo envía | Cabecera legal mínima generada en un único lugar (`brandEmail`): «lo envía <agencia> a nombre de <negocio>» | `email.test.ts` (incluye inyección de cabeceras) |
| Portal en un dominio ajeno (toma de dominio) | Verificación TXT `_impulza.<dominio>` con token aleatorio; un dominio queda verificado en un solo lugar (índice parcial + comprobación cruzada con dominios de sitio, bajo candado); no verificado → 404 sin pistas | `agency-domains.e2e.test.ts`, `packages/validation/src/domains/domains.test.ts` |
| Logo SVG con script | Saneador por lista de permitidos que reconstruye el SVG; `sharp` valida dimensiones | `packages/validation/src/branding/branding.test.ts` (`validateAndSanitizeSvg`), `platform-branding.e2e.test.ts` |

## 2. Escalada por roles y acceso delegado (F9.3, F9.6)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Un administrador crea un rol con más permisos que los suyos o se lo asigna a sí mismo | Nadie asigna permisos que no posee; nadie edita su propio rol; nombres reservados | `custom-roles.e2e.test.ts` (matriz, escalada, propietario) — 7 mutaciones atrapadas en su día |
| La agencia llega a lo que un negocio nunca delega (cobros, plan, equipo, roles, auditoría, publicación) | `delegatedAccessVerdict` en la puerta única: segmentos indelegables → `AGENCY_LIMIT`; evaluado en cada petición | `agency.e2e.test.ts`, `agency-team.e2e.test.ts` |
| Un miembro de la agencia ve clientes o módulos fuera de su alcance | `AgencyMemberScope` leído en cada petición (acotar surte efecto en la siguiente) | `agency-team.e2e.test.ts`, `packages/validation/src/team/agency-scope.test.ts` |
| Acceso persistente tras revocar/pausar/archivar | La membresía `AGENCY` se evalúa en cada petición; revocar corta en la siguiente | `agency.e2e.test.ts` (pausa/archivo/soltar/revocar) |
| El visor del portal del cliente llega a rutas no previstas | Lista de rutas permitidas (`clientViewerVerdict`): una ruta nueva queda cerrada hasta abrirla a propósito | `client-portal.e2e.test.ts`, `packages/validation/src/portal/portal.test.ts` |
| Publicar sin la aprobación configurada | La compuerta se aplica en el servidor a publicar y restaurar; solo el propietario la activa | `publish-approval.e2e.test.ts` |

## 3. Enlaces compartidos de informes (F9.8b)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Adivinar un enlace | Token de 256 bits (`randomBytes(32)`), solo se guarda su SHA-256, se muestra una vez | `report-share.e2e.test.ts` |
| Enlace que no caduca o no se puede retirar | Vencimiento obligatorio, revocación inmediata, límite de tasa | `report-share.e2e.test.ts` |
| El token se filtra por logs, caché, `Referer` o buscadores | `redactPath` en logs, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `noindex` | `report-share.e2e.test.ts` (`Cache-Control: no-store`; `noindex`, `Referrer-Policy` y `redactPath` están en el código de `apps/web` y la API, sin prueba propia — ver riesgo residual 9) |
| El informe expone datos personales o de otra organización | Solo cifras agregadas de la organización del enlace | `report-share.e2e.test.ts`, caso transversal F9.8b |
| Inyección de fórmulas al abrir el CSV | `csvCell` neutraliza celdas que empiezan por `=`, `+`, `-`, `@` | `packages/validation/src/reports/reports.test.ts`, `reports.e2e.test.ts` |

## 4. Importación CSV de clientes (F9.5d)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Fórmulas, BOM o separadores que rompen el parseo | Validación del archivo entero fila por fila en el servidor; reglas puras (comillas, CRLF, BOM) | `packages/validation/src/agency/import-csv.test.ts` (24) |
| Agotar el cupo o la base con un archivo enorme | Tope de filas (`AGENCY_IMPORT_MAX_ROWS`) y de tamaño del cuerpo, cupo del plan, cola con idempotencia por fila | `agency-import.e2e.test.ts`, `apps/worker/src/agency-import.test.ts` |
| Crear clientes con identificadores inválidos | `slugSchema` por fila; la fila inválida no crea nada y queda en el informe | `agency-import.e2e.test.ts`, `import-csv.test.ts` |
| Importar o administrar clientes desde una organización que no es agencia | Comprobación de tipo en el servidor | `agency.e2e.test.ts` («una organización que no es agencia no administra clientes») |

## 5. Reportes de abuso y moderación (F9.9)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Inundar reportes para tumbar a un competidor | Límite 5/10 min por IP, un reporte por visitante y sitio cada 24 h, tope de 200 abiertos por sitio; **nunca** una despublicación automática | `abuse-reports.e2e.test.ts` (incluye «nunca se despublica solo») |
| Usar el reporte para sondear o identificar al denunciante | Respuesta idéntica exista o no un reporte previo; no se guarda la IP; el correo nunca llega al propietario | `abuse-reports.e2e.test.ts`, `moderation-appeal.e2e.test.ts` (claves exactas de la vista del propietario) |
| Un tercero actúa como moderador | Solo `AdminSessionGuard` (superadmin + 2FA), CSRF; usuario común → 401 | `moderation-admin.e2e.test.ts`, sección «Administración» del aislamiento |
| Decisiones simultáneas o efectos a medias | Reclamación condicional del estado exacto + compensación si el efecto falla | `moderation-admin.e2e.test.ts` (carrera y compensación; 2 mutaciones atrapadas) |
| Apelar el caso de otra organización o apelar dos veces | Búsqueda siempre por `organizationId`; una apelación por decisión; reclamación condicional | `moderation-appeal.e2e.test.ts`, caso transversal F9.9 |
| Texto con HTML/caracteres de control en reporte o apelación | Texto plano saneado en servidor (`cleanPlainText`), nunca interpretado | `abuse-report.test.ts`, `abuse-reports.e2e.test.ts` |
| Medida sin explicación ni vía de salida (riesgo legal) | Motivo obligatorio y auditado, aviso con explicación, apelación aun con la organización suspendida, todo reversible y sin borrar nada | `moderation-appeal.e2e.test.ts`, Playwright `moderacion.spec.ts` |

## Riesgos residuales (honestos)

1. **Sin prueba de penetración ni auditoría externa.** Todo lo anterior es verificación propia por pruebas automatizadas.
2. **Texto legal ausente:** no hay política de contenido / términos de uso publicados que respalden las medidas de
   moderación; es decisión del propietario con revisión de un abogado.
3. **Retención de datos del denunciante** sin plazo definido (correo opcional guardado mientras exista el caso).
4. **Sin proveedor de correo real:** los avisos (moderación, informes, invitaciones) se prueban con adaptador de consola;
   la entregabilidad, SPF/DKIM y el dominio remitente verificado dependen del hosting de producción.
5. **Resolución DNS** de verificación de dominios probada con resolvedor simulado en CI; en producción depende del DNS real.
6. **Los avisos de moderación** van solo al propietario directo, no a la agencia que gestiona al cliente.
7. **Enlaces cortos y QR** son de la organización: no se despublican por sitio, solo con la suspensión de la organización.
8. **Pruebas lentas** (newsletter, auth, dominios, calendario) pueden fallar por tiempo solo cuando se corre toda la suite a
   la vez; pasan aisladas (ver CONTINUIDAD, «Tests flaky bajo carga»). No son fallos de seguridad, pero restan señal en CI.
9. **Cabeceras de la página del informe compartido** (`noindex`, `Referrer-Policy: no-referrer`) y la redacción del token en logs
   están implementadas pero sin prueba automatizada propia; solo se prueba `Cache-Control: no-store`.
