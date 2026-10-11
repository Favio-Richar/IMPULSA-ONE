# ADR-028: Agencias, marca blanca y marca configurable por el dueño de la plataforma y por cada organización

- **Estado:** Aceptado (2026-10-02). Resuelve la **decisión #8** que bloqueaba F6.8 y F6.9.
- **Origen de la decisión:** Favio pidió el 2026-10-02 desarrollar todo lo faltante (modo agencia,
  marca blanca, moderación) con la exigencia de que **cada usuario configure sus propios sistemas
  —logo incluido— y el dueño del sistema también**. El alcance concreto de abajo es la propuesta por
  defecto de Claude, aceptada al ordenar su desarrollo; es revisable por Favio sin reabrir el resto.
- **Fuente:** `PLAN_MAESTRO…` §11 (modo agencia, marca blanca, reportes), §12 (superadministración),
  §18 (Versión 1: «modo agencia inicial»). Relacionado: ADR-002 (multi-tenancy), ADR-005
  (superadministración), ADR-013 (cuentas de cobro del negocio), ADR-026 (operación técnica).

## Contexto

Hoy cada organización es independiente y el modelo no tiene jerarquía ni marca: `Organization` no
guarda logo ni colores, y no existe configuración de la plataforma (el nombre, el logo y los correos
de «Impulza One» están en código). Una agencia necesita administrar varias organizaciones de clientes,
entrar a ellas sin compartir contraseñas, presentarse con su propia marca y reportar resultados. El
dueño del sistema necesita poder cambiar la identidad de la plataforma sin tocar código. Todo esto
debe sostener ADR-002: **ninguna fuga de datos entre organizaciones**.

## Decisión

### 1. La organización del cliente sigue siendo la unidad de aislamiento
Cada cliente de una agencia es una `Organization` normal. **Todos sus datos siguen llevando su
`organization_id`** (ADR-002 no cambia). La agencia no «contiene» los datos del cliente: *accede* a
ellos mediante una relación explícita, delegada, acotada y revocable.

### 2. Modelo (nombres orientativos; el esquema final lo fija la migración de F9.3)
- `Organization.kind`: `BUSINESS` (por defecto) o `AGENCY`. Una agencia es una organización con plan
  de agencia (límite de clientes por plan).
- `AgencyClient` (`agencyOrganizationId`, `clientOrganizationId`, `status`: `INVITED | ACTIVE | PAUSED |
  ARCHIVED | TRANSFERRING`, `billingMode`: `CLIENT_PAYS | AGENCY_PAYS`). Un cliente tiene **como máximo
  una agencia activa** a la vez.
- **El acceso de la agencia a un cliente es una `Membership` en la organización del cliente**, con
  origen `AGENCY` (`agencyClientId`), un rol delegado y permisos por módulo. No existen contraseñas
  compartidas ni cuentas de servicio. «Entrar al cliente» es cambiar la organización activa (ADR-002
  §3) y cada acción queda auditada con el actor real **y** la agencia.
- **Límites duros de la delegación** (ninguno se puede saltar con un rol personalizado):
  la agencia **nunca** puede: eliminar la organización del cliente, cambiar su propietario, ver ni
  modificar su cuenta de cobro (token OAuth de Mercado Pago, ADR-013), cambiar datos de acceso del
  propietario, ni exportar la lista de contactos sin el permiso explícito del cliente.
- **El propietario del cliente puede revocar** el acceso de la agencia en cualquier momento; la
  revocación es inmediata (sesiones de ese contexto invalidadas) y queda auditada.
- Pausa y archivo son estados de la relación y del sitio, **no borran datos**. Transferencia: la
  organización pasa del control de la agencia al propietario (o a otra agencia) con **doble consentimiento**
  y sin migrar datos (solo cambia la relación). La duplicación crea una **organización nueva** copiando
  sitios, páginas, bloques y temas, nunca contactos, pedidos ni medios con datos personales.
- Facturación: `CLIENT_PAYS` (cada cliente su suscripción) o `AGENCY_PAYS` (la agencia paga los planes
  de sus clientes dentro de su cupo). El cambio de modo lo confirma el propietario del cliente.

### 3. Roles personalizados y aprobación antes de publicar
- `CustomRole` por organización compuesto **solo de permisos del catálogo cerrado** (`Permission`).
  Nadie puede otorgar un permiso que no tiene (sin escalada de privilegios) ni modificar su propio rol.
- Permisos acotables por **módulo** y, en agencias, por **cliente**.
- **Aprobación antes de publicar**: si la organización lo activa, un rol sin permiso de publicar solicita
  la publicación; un aprobador la acepta o rechaza con comentario. La publicación sigue verificándose
  en el servidor (no solo en la interfaz).

### 4. Marca configurable en tres niveles, con respaldo en cascada
1. **Plataforma** (`PlatformBranding`, singleton, solo superadministración): nombre, logo claro/oscuro,
   favicon, colores de marca, correo y nombre del remitente, enlaces legales y de soporte.
2. **Organización** (`BrandProfile`): nombre visible, logo, favicon, color principal y secundario,
   datos de contacto y razón social. Alimenta el panel de ese cliente cuando hay marca blanca, los
   correos, los reportes y los valores por defecto de las páginas públicas.
3. **Agencia — marca blanca** (`WhiteLabelSettings`): la marca de la agencia reemplaza a la de la
   plataforma en el panel y los correos **de sus clientes**, además de dominio propio del portal.
- **Resolución:** marca blanca de la agencia (si el cliente la tiene) → marca de la organización →
  marca de la plataforma. Siempre hay un valor válido (el respaldo es la marca por defecto de Impulza).
- Toda marca cumple **WCAG 2.2 AA**: el servidor **rechaza** colores cuyo contraste con el texto/fondo
  sea insuficiente, y los logos pasan por el pipeline de medios existente (tipos permitidos, tamaño,
  optimización, sin SVG con scripts).
- **Nunca se copia la marca de terceros**; sí se exige que la plataforma indique cuándo un correo viene
  de una agencia (cabecera legal mínima) para evitar suplantación.

### 5. Dominio de agencia y correos con marca
- El dominio propio del portal reutiliza la infraestructura de dominios existente (verificación por
  DNS, estados, HTTPS). Un dominio **no verificado nunca sirve el portal**.
- Los correos con marca de agencia solo usan un remitente cuyo dominio esté **verificado** (SPF/DKIM
  según el proveedor de correo). Sin verificación, el correo sale con el remitente de la plataforma y
  el nombre de la agencia visible. Esto no requiere credenciales para desarrollarse: el estado
  «pendiente de verificación» y el respaldo son parte del diseño.

### 6. Reportes
Informe por cliente con comparación de periodos, programación (cola BullMQ, idempotente), comentarios,
exportación (CSV y versión imprimible, sin dependencia de PDF pesada salvo ADR nuevo) y **enlace
compartido**: token aleatorio de alta entropía, de solo lectura, con vencimiento, revocable, sin datos
personales de contactos y con límite de tasa. Los datos salen **solo de la organización del cliente**.

### 7. Moderación y reportes de abuso (decisión #9)
`AbuseReport` creado desde un formulario público (límite de tasa por IP, sin exigir datos personales,
motivo de un catálogo cerrado). Cola de moderación en `apps/admin` con acciones auditadas: descartar,
advertir al propietario, despublicar el sitio, suspender la organización. El propietario recibe aviso
con motivo y vía de apelación. Nada se borra; todo es reversible y queda auditado.

## Alternativas consideradas

- **Que la agencia «contenga» los datos de sus clientes (organización padre con datos propios):**
  descartado, rompe ADR-002 y haría que cada consulta tuviera que decidir de qué nivel viene el dato.
- **Cuentas de servicio o contraseñas compartidas para «entrar como» el cliente:** descartado por
  seguridad y trazabilidad; una `Membership` delegada es revocable y auditable.
- **Marca solo por variables de entorno o en código:** descartado; el dueño y cada usuario deben
  configurarla desde la interfaz.
- **Aislamiento físico por agencia:** fuera de alcance (ADR-002 lo difiere hasta que un cliente lo exija).

## Consecuencias

- Positivo: ADR-002 se mantiene intacto; la agencia es una capa de **acceso delegado**, no de datos.
- Positivo: la marca en cascada permite marca blanca sin duplicar pantallas.
- Negativo: toda consulta del panel que hoy asume «mi organización activa» debe validar además, cuando
  el acceso es delegado, que la relación `AgencyClient` esté `ACTIVE` y el módulo permitido. Se mitiga
  con **un único guard** reutilizable y con pruebas de aislamiento por cada endpoint nuevo.
- Negativo: migraciones sobre `organizations`, `memberships`, `roles/permissions` y plantillas
  (`organization_id` opcional para plantillas privadas). Cada una con migración reversible y respaldo.
- Riesgo a vigilar: suplantación por marca blanca → mitigado con la cabecera legal en correos y con la
  verificación de dominio.
- Seguimiento: cada historia de la Fase 9 suma sus casos a `multi-tenant-isolation.e2e.test.ts` y, para
  el acceso delegado, un conjunto propio «agencia no sale de su cupo».

## Notas de implementación de F9.3 (2026-10-03)

- **Estado `ENDED`** agregado a `AgencyClientStatus`: soltar, rechazar o revocar terminan la relación sin borrarla (queda la
  historia y la auditoría); el índice único parcial solo cuenta las relaciones no terminadas.
- **`agencyCreated`** distingue al cliente creado por la agencia (trabaja desde ya, mientras el propietario acepta su invitación)
  del negocio vinculado (sin acceso hasta que su propietario acepte).
- **«Un único guard»**: se cumple con la puerta que ya existía, `OrganizationMembershipGuard`, que aplica
  `delegatedAccessVerdict` (reglas puras en `@impulza/validation`). No se creó un `AgencyAccessGuard` aparte: duplicaría la puerta.
- **«Sesiones invalidadas» al revocar**: no hay una sesión propia de la agencia; el acceso se evalúa **en cada petición** contra la
  membresía y el estado de la relación, así que la revocación es efectiva desde la siguiente petición.
- **Despublicar al pausar/archivar** (criterio 7): `Organization.public_hidden_at`, reversible y visible para el propietario. Es una
  decisión del propietario de la plataforma (2026-10-03): reversible, en lugar de retirar páginas publicadas una a una.
  Reanudar, desarchivar, soltar y la revocación del propietario siempre vuelven a mostrar el sitio.

## Notas de implementación de F9.5a — facturación (2026-10-03)

- **Qué significa `AGENCY_PAYS` (decisión del propietario de la plataforma):** el negocio usa **los límites del plan de la agencia** (su
  cupo) y no necesita suscripción propia; **no se cobra nada nuevo ni se toca Mercado Pago**. El cobro real a la agencia sigue siendo su
  propia suscripción. Un cobro por cliente con el proveedor de pagos queda para cuando exista un proveedor real configurado.
- **Quién decide:** la agencia propone y el propietario confirma (aviso por correo). El propietario puede volver a pagar él (`CLIENT_PAYS`)
  y se aplica al instante; pedir que la agencia pague lo ofrece la agencia. Excepción: un cliente que la agencia creó y cuyo propietario aún
  no acepta la invitación no tiene a quién pedir confirmación, así que se aplica.
- **Precedencia del plan:** la suscripción propia vigente y el plan asignado a mano por Impulza One **mandan sobre** el plan de la agencia: nadie
  pierde lo que ya paga o lo que decidió la plataforma porque una agencia ofrezca pagar. Archivar, terminar o revocar devuelve al negocio a su plan.

## Notas de implementación de F9.5b — traspaso (2026-10-03)

- **Quién consiente (decisión de diseño, más estricta que el mínimo):** el ADR pedía «doble consentimiento». Se interpretó así: el **propietario del
  negocio siempre** debe aceptar —si no, una agencia podría pasar a un cliente a otra sin que el dueño lo sepa— y, cuando el destino es otra agencia, **la
  agencia receptora también** (con lo que son dos aceptaciones además de la propuesta). Hacia el propietario basta su aceptación.
- **Antes de aceptar nada cambia:** `TRANSFERRING` da el mismo acceso que `ACTIVE`; solo se inicia desde `ACTIVE` (desde una pausa daría escritura antes
  de tiempo); mientras dura no se puede pausar ni archivar. Soltar al cliente o que el propietario revoque cancelan el traspaso.
- **Al completarse:** cambia la relación, nunca los datos. La agencia saliente pierde el acceso al instante, se cierra lo que había propuesto (facturación),
  se vuelve a mostrar el sitio si lo había ocultado y quién paga vuelve a empezar (`CLIENT_PAYS`) con la nueva agencia o con el propietario.
- **Vencimiento (14 días):** se aplica al leer o decidir, no con una tarea programada; una relación que quedó en `TRANSFERRING` sin un traspaso pendiente
  vuelve sola a `ACTIVE`. La agencia receptora debe tener cupo de clientes: se comprueba al aceptar y de nuevo al completar.
- **Sin sondeos:** a la agencia receptora se la identifica con su identificador **y** el correo de su propietario, como al vincular un negocio.

## Notas de implementación de F9.5c — duplicar un cliente (2026-10-03)

- **Qué es:** crear una organización nueva con el contenido del sitio de otra, en **borrador**. El criterio original pedía copiar «sitios, páginas, bloques,
  temas y marca» y **nunca** contactos, pedidos, pagos, medios con datos personales, claves ni cuentas de cobro.
- **Regla de fondo — ninguna referencia cruzada:** una copia no puede quedar apuntando a un archivo o recurso del cliente origen (rompería ADR-002 y
  filtraría datos del origen). Por eso: las imágenes de la biblioteca del origen (se reconocen por `/org/<id>/` en la URL) se **quitan** de bloques, SEO,
  fondo y texto enriquecido; los bloques que apuntaban a un formulario, servicios o productos del origen quedan **sin configurar**; las reglas del botón
  inteligente se rehacen con los ids de los bloques nuevos; y no se copian los identificadores de medición (GA4, Pixel), que mandarían las visitas del
  cliente nuevo a la cuenta del origen. De la marca solo viajan los colores.
- **Decisión sobre los medios:** no se copian archivos. Como no se puede saber si una imagen contiene datos personales, la regla conservadora es no copiar
  ninguna de la biblioteca; el informe dice cuántas se quitaron para que se vuelvan a subir.
- **Se respeta el plan del cliente nuevo** (sitios y páginas por sitio; la página de inicio siempre viaja) y el informe indica qué quedó fuera. Un bloque que
  queda inválido tras la limpieza no se copia a medias: se omite y se informa.
- **Datos del negocio origen que sí viajan** (son contenido del sitio, no datos de sus clientes): textos, enlaces, números de WhatsApp, correo y teléfono de
  contacto de los bloques, direcciones del mapa, redes sociales y testimonios. Como casi seguro no son los del cliente nuevo, el informe los lista en
  «Revisa antes de publicar», y como todo queda en borrador nada sale al público sin que alguien lo publique.
- **Idempotente y atómico:** la clave de idempotencia (`idempotencyKey`) hace que reintentar devuelva el mismo resultado (`replayed: true`) sin crear otro
  cliente ni otro correo; la misma clave con otra petición es 409. La organización, la relación, la invitación y todo el contenido se crean en **una**
  transacción: si algo falla no queda nada a medias y la clave no se «gasta».
- **Transparencia con el dueño del origen:** queda una entrada de auditoría en el negocio origen (`agency.client.duplicated_from`) sin decir a dónde. No se
  pide su consentimiento: la agencia ya tiene acceso delegado de edición a ese contenido; es una reserva a revisar si se quiere endurecer.

## Notas de implementación de F9.5d — importar clientes por CSV (2026-10-04)

- **Dónde se procesa:** en el **worker**, por una cola BullMQ (`agency-import`), como manda la arquitectura. La API valida el archivo entero y guarda cada fila; no crea
  ningún cliente, así subir un archivo grande responde al instante. La lógica compartida vive en el paquete nuevo `@impulza/agency`: el alta de un cliente y el acceso
  delegado ya no se escriben dos veces (la API los usa desde ahí).
- **Fila por fila:** cada fila se valida en el servidor y se crea en su propia transacción: un error no frena a las demás y el avance se ve fila a fila. Cada fila se
  *reclama* (`PENDING → PROCESSING`) antes de crearse: dos workers nunca crean la misma. Si un worker muere a mitad, la fila colgada vuelve a la cola y, si el cliente ya
  se había creado, queda como existente (no se duplica).
- **Idempotencia:** reimportar el mismo archivo no duplica. Una fila cuyo identificador ya es un cliente **de esta agencia, creado por ella y con ese mismo correo** queda
  `EXISTED` (sin otra invitación). Un identificador de otro negocio, o de un cliente propio con otro correo o ya terminado, es un error de esa fila.
- **Cupo del plan:** se congela al subir (`clients_limit`) y el worker lo comprueba con el **mismo candado** que usa la API al crear clientes (`plan-limit:<agencia>:clients`):
  una importación y un alta manual no pasan juntas el límite. Las filas que ya no caben quedan con error `NO_QUOTA`, no se pierden en silencio. Tope: 200 filas y
  45 000 caracteres por archivo (por debajo del cuerpo JSON por defecto de la API, para que el mensaje sea siempre el claro). Una importación a la vez por agencia.
- **Sin inyección de fórmulas:** un CSV es texto y nada se evalúa. Todo lo que **sale** en un CSV (plantilla e informe de errores) pasa por `csvCell`, que antepone una comilla
  simple a lo que una hoja de cálculo ejecutaría (`=`, `+`, `-`, `@`, tabulación, retorno), venga de quien venga. El lector acepta coma, punto y coma (el de Excel en español) o
  tabulación, comillas con separadores y saltos de línea adentro, BOM y CRLF; una comilla sin cerrar es un error claro.
- **Archivos de Excel en Windows:** el panel lee el archivo como UTF-8 y, si no lo es, como Windows-1252, para no romper tildes y eñes; y conserva el BOM al descargar
  (`response.text()` lo descarta por especificación: se decodifican los bytes).
- **Privacidad:** las filas guardan correos de terceros (propietarios de clientes), así que se borran a los 60 días.

## Notas de implementación de F9.6a — roles personalizados (2026-10-04)

- **Piso de solo lectura:** una membresía con rol personalizado guarda `role_id = ANALYST` y `custom_role_id`. Toda decisión de permisos pasa por `permissionsOfMembership`; el rol
  del sistema que queda debajo no concede nada, así que un olvido en algún punto del código falla cerrado.
- **Escalada:** las reglas son funciones puras (`memberChangeVerdict`, `missingPermissions`) con su prueba, y el servidor las aplica al invitar, cambiar rol, quitar y al crear,
  editar o borrar un rol. Nadie entrega lo que no tiene, ni se toca a quien tiene más que uno, ni se cambia el propio rol; el propietario es intocable por esta vía.
- **Agencia:** `/roles` se suma a lo que un cliente nunca delega (junto con `members`); el rol delegado de la agencia sigue siendo el del sistema.

## Notas de implementación de F9.6b — acceso del equipo de agencia por cliente y módulo (2026-10-04)

- **Sin fila = todo:** el alcance es una restricción opcional por persona, no un permiso nuevo; así nada de F9.3 cambia y un olvido falla hacia lo que ya existía, pero **acotar** falla cerrado (la puerta lo
  vuelve a comprobar en cada petición, además de que la sincronización quita las membresías de los clientes excluidos).
- **Una sola lectura:** `loadMemberScope` vive en `@impulza/agency` y la usan la API (sincronización y puerta de entrada) y el worker (importación y altas): una regla.
- **Módulos por ruta:** `agencyModuleOfSegments` (pura, probada contra rutas reales) agrupa las rutas en 11 módulos; lo que no es módulo no se acota.
- **Sin escalada:** `scopeChangeVerdict` — nadie cambia su propio acceso, el propietario no se acota y nadie da más alcance del que tiene (`scopeWithin`).

## Notas de implementación de F9.7a (2026-10-11)

- **Cascada con dos audiencias.** El ADR dice a la vez que la marca blanca «reemplaza a la de la plataforma» y que el orden es «marca blanca → organización → plataforma». Aplicado al pie de la letra, la
  agencia taparía la marca propia del negocio en los correos que **él** envía a **sus** clientes (una confirmación de reserva saldría con el nombre de la agencia). Se resolvió con una sola función
  (`cascadeBrand`, `@impulza/validation`) y dos audiencias: **`team`** (panel y avisos que ve el equipo del cliente): marca blanca → organización → plataforma; **`customer`** (lo que el negocio envía a su
  público): organización → marca blanca → plataforma. Cada campo se resuelve por separado.
- **Cuándo aplica:** solo mientras la relación esté ACTIVE (o creada por la agencia y aún sin aceptar el propietario) **y** la agencia la haya activado para ese cliente. Si la relación termina, se pausa o se archiva,
  el panel vuelve solo a la marca de la plataforma. Una sola lectura (`loadWhiteLabelBrand`, `@impulza/agency`) la comparten la API y el worker.
- **Suplantación:** el nombre no puede ser el de la plataforma, el de otra marca blanca ni el de un negocio que no es cliente de la agencia (comparación sin tildes, mayúsculas ni signos); los logos solo pueden
  ser archivos subidos por la propia agencia a su espacio (`branding/agency/<id>/`).
- **Pendiente de F9.7b–e:** remitente y cabecera legal de los correos (b), plantillas privadas (c), dominio de agencia (d) y portal del cliente (e).
