# ADR-020: Secuencias de correo sobre los eventos de las automatizaciones

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** F7.5 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.12–9.13 (seguimiento y email
  marketing), F6.7 (automatizaciones), F5.6 (campañas, baja y límite por hora), ADR-019 (newsletter).
  Aprobado por el propietario al pedir continuar con el desarrollo completo.

## Contexto

Las automatizaciones (F6.7) hacen **una** acción por evento. Lo que un negocio necesita después de
captar a alguien es una **serie** de correos en el tiempo: bienvenida al suscribirse, consejos a los
3 días, una oferta a la semana; o seguimiento después de una reserva o un pedido. Las campañas (F5.6)
son envíos únicos a un segmento. Hay que decidir de dónde nacen las inscripciones, cómo se programa
cada correo, cómo se respeta el consentimiento y la baja, y cómo no se pasa del límite del plan.

## Decisión

1. **Mismo origen que las automatizaciones.** Una secuencia se activa con un disparador del mismo
   catálogo (contacto nuevo, reserva, pedido y, nuevo, **suscripción confirmada a la newsletter**).
   La API ya encola el evento (solo ids) si hay automatizaciones **o** secuencias activas para ese
   disparador; el worker inscribe al contacto al procesarlo.
2. **Una inscripción por contacto y secuencia, para siempre** (único `sequence_id + contact_id`):
   una bienvenida no se repite aunque el contacto vuelva a escribir.
3. **Solo con consentimiento de marketing vigente**, revisado al inscribir y **otra vez justo antes
   de cada correo**. Si se dio de baja, la inscripción se detiene. Cada correo lleva el enlace de baja
   (`/baja/:token`, firma HMAC con un **propósito propio**, distinto del de campañas) y
   `List-Unsubscribe`. La baja es global de marketing, igual que en F5.6.
4. **Pasos con espera relativa** al paso anterior (o a la inscripción): de 0 horas a 365 días; hasta
   10 pasos y 10 secuencias por organización. Asunto y cuerpo con `{{nombre}}` opcional, reemplazado
   por el nombre escapado (o nada si no hay nombre). El cuerpo es texto enriquecido saneado en el
   servidor.
5. **Envío idempotente con concesión:**
   - El worker reclama la inscripción corriendo su próxima hora 15 minutos (si el proceso muere, se
     reintenta sola).
   - Registra el envío con una fila única por inscripción y paso: un reintento nunca manda dos veces.
   - Después programa el paso siguiente o cierra la inscripción.
6. **Límite por hora del plan compartido con las campañas:** la API congela `emailsPerHour` del plan
   en la secuencia al crearla o encenderla. El worker no envía más que ese límite menos lo ya enviado
   por campañas y secuencias de la organización en la última hora; lo que no cabe espera a la pasada
   siguiente.
7. **Cambios en caliente:** apagar una secuencia pausa sus inscripciones, sin perderlas. Editar los
   pasos afecta solo lo que falta enviar. Borrar un paso hace que la inscripción salte al siguiente
   que exista.

## Alternativas consideradas

- **Una tabla de "correos programados" por contacto al inscribir:** congela el contenido y cualquier
  edición posterior no llega. Además multiplica filas. Descartada: la inscripción guarda solo el
  próximo paso.
- **Usar los reintentos y retrasos de BullMQ por correo:** los trabajos retrasados de días en Redis
  se pierden con un reinicio sin persistencia y no se ven en la base. Descartada: la base es la fuente
  de verdad y una pasada por minuto envía lo vencido.
- **Inscribir sin consentimiento de marketing (correos "transaccionales"):** una serie de correos de
  seguimiento es marketing. Descartada por ADR-004.

## Consecuencias

- Positivas: bienvenida y seguimiento automáticos sin custodiar nada nuevo; misma baja, mismo límite
  y misma auditoría que las campañas.
- Negativas: un paso editado después de inscribir cambia lo que recibe quien todavía no lo recibió
  (es lo esperado). Las esperas tienen granularidad de un minuto.
- Seguimiento: condiciones por paso (abrió, compró) quedan para cuando haya medición de aperturas.
