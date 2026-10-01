# ADR-019: Newsletter con doble confirmación, sin crear el contacto hasta que la persona confirma

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** F7.4 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.12 (captación), ADR-004 (datos personales,
  consentimiento auditado y minimización), F5.6 (campañas y baja). Aprobado por el propietario al
  pedir continuar con F7.4.

## Contexto

Las campañas (F5.6) solo llegan a contactos con consentimiento de marketing. Hoy ese consentimiento
nace de una casilla en un formulario, una reserva o un pedido: basta escribir **cualquier** correo,
incluso uno ajeno. Un bloque de "suscríbete a mi newsletter" en la página pública es la vía más
directa para sumar suscriptores, y también la más fácil de abusar (llenar la lista de otros, o usar el
formulario para mandar correos a terceros). La práctica estándar —y lo que piden las leyes de
protección de datos y los proveedores de correo— es la **doble confirmación**: solo cuenta quien
abre el enlace que llegó a su correo.

## Decisión

1. **La solicitud no crea un contacto.** Queda una fila `newsletter_confirmations` con el correo, el
   nombre opcional, el sitio, la versión del texto aceptado y el **hash** (SHA-256) de un token de 32
   bytes; el token solo viaja en el correo. Vence a las **48 horas**.
2. **Confirmar es un clic, no abrir el enlace:** la página `/suscripcion/:token` pide presionar
   "Confirmar" (los escáneres de correo abren los enlaces solos). Al confirmar se crea o actualiza el
   contacto, se registra el consentimiento de marketing con su fuente
   (`newsletter:<sitio>:double_opt_in`), versión y fecha, se etiqueta `newsletter`, se anota en su
   historial y se audita. Confirmar dos veces no cambia nada. Volver a suscribirse después de una baja
   la deja sin efecto (decisión nueva y explícita, igual que F5.6).
3. **Sin pistas para terceros:** la respuesta a la solicitud es siempre la misma ("revisa tu
   correo"), exista o no el contacto y esté o no suscrito. A quien ya está suscrito le llega un aviso
   sin enlace. Topes contra el abuso: por IP (limitador existente), y **3 correos por dirección y
   sitio cada 24 h** (los siguientes se descartan en silencio). Honeypot como en los formularios.
4. **Minimización:** las solicitudes no confirmadas se borran al día siguiente de vencer y las
   confirmadas a los 30 días (la prueba del consentimiento queda en el contacto y en la auditoría).
5. **Medición (ADR-016):** con consentimiento del visitante, la solicitud se informa como `sign_up`
   (GA4) y `Lead` (Meta), sin datos personales.

## Alternativas consideradas

- **Crear el contacto al pedir, marcado "pendiente":** guarda datos de alguien que quizá nunca pidió
  nada (pudo escribir un correo ajeno). Descartada por ADR-004.
- **Confirmar al abrir el enlace (GET):** los antivirus de correo lo abren solos y confirmarían
  suscripciones no pedidas. Descartada.
- **Suscripción simple (sin confirmar):** permite llenar la lista con correos ajenos, daña la
  reputación del remitente y no prueba el consentimiento. Descartada.

## Consecuencias

- Positivas: lista con consentimiento demostrable; nada de datos de quien no confirmó; el formulario
  no sirve para molestar a terceros.
- Negativas: parte de quienes piden no confirma (es lo esperado con doble confirmación); el correo de
  confirmación depende del proveedor de correo real (en desarrollo, la consola).
- Seguimiento: una secuencia de bienvenida (F7.5) se dispara al confirmar.

## Restricciones asociadas

- Nunca se guarda el token en claro ni se registra en logs.
- El panel no puede declarar suscripciones: solo la persona, desde su correo.
