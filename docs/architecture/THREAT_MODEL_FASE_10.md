# Revisión de amenazas — Fase 10 (miembros, membresías, cursos, tarjeta digital, PWA y marketplace)

**Alcance:** lo construido en F10.1 a F10.6 (ADR-029, ADR-030). **Fecha:** 2026-10-12. **Método:** por cada superficie nueva,
quién podría abusar de ella, qué se hizo para impedirlo y **qué prueba lo demuestra**. Donde no hay prueba o la defensa es
parcial, se dice (sección «Riesgos residuales»). No sustituye una auditoría externa ni una prueba de penetración.

Principio común (ADR-002): el servidor nunca confía en el `organizationId` ni en el `siteId` del cliente. Dos barridos
automáticos recorren el OpenAPI publicado (una ruta nueva queda cubierta sin tocarlos), en
`apps/api/src/multi-tenant-isolation.e2e.test.ts`:

- **«Barrido de TODAS las rutas de organización»** (F9.10): exige 403 a quien no es miembro, en ambos sentidos y con un administrador.
- **«Barrido por sitio»** (F10.7): con la organización **propia** pero el `siteId` de otra, ninguna de las ~90 rutas por sitio
  (miembros, planes, cursos, tarjeta, reservas, tienda…) responde un éxito ni un 5xx, y el sitio ajeno no cambia. Verificado
  contra código roto: usando el sitio propio en lugar del ajeno, la prueba falla.

## 1. Enlaces mágicos y sesiones de miembros (F10.1)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Enumerar qué correos son miembros | `POST …/members/access` responde igual exista o no; el correo se envía sin esperar (el tiempo no delata) | `members.e2e.test.ts` («pedir acceso responde igual para cualquiera») |
| Reutilizar o adivinar un enlace | Un solo uso, vence en 15 min, solo se guarda el SHA-256; dos canjes simultáneos: entra uno | `members.e2e.test.ts` («un solo uso», «dos canjes simultáneos») |
| Inundar de correos a una persona o al sistema | Límite por IP y 3 pedidos por correo cada 10 min; pasado el tope se responde igual sin enviar | `members.e2e.test.ts` («límite de pedidos») |
| Sesión que sobrevive a la revocación | Revocar corta sesiones y enlaces pendientes; además cada petición vuelve a comprobar que el miembro siga activo y el sitio servido | `members.e2e.test.ts` («revocar corta el acceso en el acto», «defensa en profundidad») |
| Sesión de un sitio usada en otro, o para entrar al panel | Cookie `HttpOnly` por sitio; modelo propio (`SiteMember`, nunca `User`); la sesión de miembro no abre ninguna ruta del panel | `members.e2e.test.ts` («permisos y aislamiento»), `courses.e2e.test.ts` («sesión … de otro sitio no») |
| Contenido «solo miembros» filtrado por caché, SEO o menú | La página se devuelve sin bloques, `noindex_nofollow`, sin descripción ni imagen, fuera del `sitemap.xml`; el contenido sale solo por una ruta con sesión y `Cache-Control: no-store` | `members.e2e.test.ts` («una página solo para miembros no entrega su contenido…») |

## 2. Cobros del negocio: Mercado Pago y Webpay Plus (F10.2, ADR-030)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| El visitante fija su propio precio | El monto sale del plan, del pedido o de la seña **guardados**; el cuerpo rechaza campos de precio | `membership.e2e.test.ts` («la compra crea el cobro … con el precio del plan»), `webpay-plus.e2e.test.ts` |
| Activar con un aviso o un regreso falso | Nunca se confía en el aviso ni en la URL: se consulta/confirma el pago con las credenciales del negocio y solo se aplica si cuenta, referencia, monto y moneda coinciden; en Webpay se confirma el token **guardado**, no el de la URL | `membership.e2e.test.ts` («un pago que no corresponde…»), `webpay-plus.e2e.test.ts` |
| Doble activación por avisos simultáneos | Asignar el pago es condicional (`unchanged` para el segundo); el pago identificado como `webpay:<orden>` es único | `membership.e2e.test.ts` («dos avisos simultáneos»), `webpay-plus.e2e.test.ts` (regresos simultáneos) |
| Robo o filtración de la llave del negocio | Llave cifrada con la clave de los tokens; nunca vuelve a salir (solo los últimos 4 del comercio); se comprueba de verdad antes de guardar; solo con `payments.connect` | `webpay-plus.e2e.test.ts` |
| Custodia de dinero de terceros | Descartada por diseño: el dinero va directo al comercio del negocio, sin comisión ni reparto | ADR-030 |
| Avisos de renovación duplicados o a quien no corresponde | Marca reclamada de forma condicional antes de enviar; excluye renovados, revocados, reembolsados y sitios ocultos | `membership-lifecycle.e2e.test.ts` (6 pasadas simultáneas) |
| Formulario hacia Webpay bloqueado por la política de contenido | `form-action` incluye `https://*.transbank.cl` con prueba unitaria de la política y de navegador | `apps/web` (seguridad de cabeceras), Playwright de F10.2d |

## 3. Cursos (F10.3)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Leer una lección sin acceso | Decide el servidor (`canAccessCourse`); la lección bloqueada responde 403 `COURSE_LOCKED` **sin cuerpo ni video**; el temario nunca lleva contenido | `courses.e2e.test.ts` («el contenido de una lección bloqueada no sale») |
| Acceso por plan tras vencer o reembolsar | Se evalúa el periodo vigente en cada petición; reembolso total y contracargo cortan | `courses.e2e.test.ts` («acceso PLAN») |
| Script en el texto de una lección | Texto enriquecido saneado en el servidor; video solo por proveedor + id (nunca URL libre) | `courses.e2e.test.ts` («el texto de una lección se sanea») |
| Marcar progreso de otra persona o sin acceso | El progreso se ata a la sesión de miembro; exige acceso al curso y la cabecera anti-CSRF | `courses.e2e.test.ts` («progreso por miembro … aislamiento entre personas», «el progreso exige acceso») |
| Un curso leído con el sitio de otro negocio | Slug y lecciones solo existen dentro de su sitio | `courses.e2e.test.ts` («aislamiento») |

## 4. Tarjeta digital y pases de wallet (F10.4)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Inyección en la vCard (abrir otra propiedad u otra tarjeta) | Escape de `\`, `;`, `,` y saltos; control quitado; plegado a 75 octetos sin partir UTF-8; nombre de archivo saneado | `digital-card.e2e.test.ts` («la vCard … sin inyección»), pruebas unitarias de vCard |
| Un pase que lleva datos de otro sitio | Los datos del pase salen solo de la tarjeta del sitio dueño; `serialNumber` por sitio | `digital-card.e2e.test.ts` («aislamiento … cada pase sale con los datos de su sitio») |
| Pase firmado con credenciales mal manejadas | Variables de entorno validadas (todas o ninguna); sin credenciales: 503 claro y el resto sigue; firma PKCS#7 y JWT verificados en prueba | `wallet/wallet.test.ts`, `digital-card.e2e.test.ts` («sin credenciales») |
| Tarjeta desactivada que sigue accesible | Página, vCard y pases responden 404 | `digital-card.e2e.test.ts` («una tarjeta desactivada…») |

## 5. PWA y service worker (F10.5)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Caché de respuestas con sesión o datos personales | El service worker atiende solo GET del mismo origen, nunca `/api/` ni `/sw.js`; páginas siempre a la red; solo estáticos con huella e íconos; jamás una respuesta con `Set-Cookie` o un error | `packages/pwa/src/service-worker.test.ts` (11 pruebas), Playwright `pwa.spec.ts` («ninguna URL `/api/` ni página con datos en Cache Storage») |
| Quedar atrapado en una versión rota | La versión nueva espera; solo se activa al pulsar «Actualizar»; el propio `/sw.js` no se cachea | Playwright `pwa.spec.ts` |
| Alcance excesivo del service worker de un sitio | `start_url` y `scope` del manifiesto dentro de `/:sitio/` | Playwright `pwa.spec.ts` |

## 6. Marketplace (F10.6)

| Amenaza | Mitigación | Prueba |
|---|---|---|
| Un socio publica HTML o JavaScript ejecutable | Solo datos declarativos: bloques del catálogo cerrado (`templateSchema`) o lista de eventos; texto enriquecido saneado al publicar y al instalar | `marketplace.e2e.test.ts` («valida en el servidor … sin HTML ejecutable») |
| Una publicación sin revisar llega a clientes | Nace `IN_REVIEW` e invisible; solo la superadministración aprueba | `marketplace.e2e.test.ts` («una publicación nueva queda en revisión…», «solo la administración revisa») |
| Una integración como vía de SSRF o de fuga | Crea un destino de webhooks con la misma validación SSRF y firma que los demás; la clave se muestra una sola vez | `marketplace.e2e.test.ts` («instalar una integración…») |
| Permisos que el socio declara a su gusto | Los permisos que se muestran salen de los datos, no del texto del socio | `marketplace.e2e.test.ts` («los permisos del listado salen de los datos») |
| Quedan instalaciones de algo retirado | Retirar desinstala de todas las organizaciones, con motivo y auditoría | `marketplace.e2e.test.ts` («retirar una publicación…») |
| Inundar el directorio | Tope de 10 publicaciones vivas por organización y 50 instalaciones | `marketplace.e2e.test.ts` («publicar tiene un tope») |

## Riesgos residuales (honestos)

1. **Webpay Plus no avisa reembolsos ni contracargos:** la devolución la hace el negocio en Transbank y el sistema no la detecta sola (el miembro sigue con acceso hasta que el negocio lo revoque). Pendiente: acción «anular compra» en el panel.
2. **Nada se ejerció contra Transbank, Google Wallet ni Apple Wallet reales:** solo simuladores y certificados de prueba; el propietario debe probar con sus credenciales.
3. **Sin cobro recurrente automático:** los periodos son prepagados; es una decisión de modelo, no un hueco, pero un negocio que espere cobro automático no lo tiene.
4. **Correos por el adaptador de consola** hasta que el propietario configure un proveedor real: los enlaces mágicos no llegan a una bandeja real todavía.
5. **Sin límite de miembros por plan** (solo el tope técnico de 5000 por sitio) y sin límite de plan específico para tarjetas.
6. **El service worker solo se registra en producción**; la prueba de Playwright lo ejerce sobre el build de producción, pero en `next dev` no hay cobertura.
7. **Aprobación del marketplace es manual:** una revisión humana de datos declarativos no detecta intención maliciosa en una integración que reenvía eventos a un tercero que el *instalador* eligió; el riesgo está acotado porque el destino lo pone quien instala y porque no hay lectura de datos desde el socio.
8. **Sin auditoría externa ni prueba de penetración** de las superficies públicas nuevas (enlace mágico, retorno de pagos, vCard, pases).
