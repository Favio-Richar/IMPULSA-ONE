# ADR-002: Multi-tenancy estricto por organización desde el primer commit

- **Estado:** Aceptado
- **Fecha:** 2026-09-14
- **Fuente:** `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §3.2, §22; ERD (`docs/architecture/ERD.md`)

## Contexto

Impulza One sirve a profesionales, negocios y agencias que administran varias cuentas de cliente.
Una fuga de datos entre organizaciones (un cliente viendo contactos, páginas o analítica de otro)
sería un incidente de seguridad crítico y un riesgo reputacional y legal grave para un SaaS
comercial. El propio documento de arquitectura marca esto como regla obligatoria, no como
optimización posterior.

## Decisión

1. **Toda entidad comercial** (Site, Page, Block, Contact, Form, MediaAsset, ShortLink, QrCode,
   AnalyticsEvent, Notification, AuditLog, Subscription, UsageCounter) lleva `organization_id`
   obligatorio y no nulo.
2. El `organization_id` usado en cada operación se resuelve **desde el contexto de autenticación y
   membresía verificada** (sesión → `Membership` → `Organization`), nunca desde un valor que el
   cliente envía en el body, query string o header, salvo para validar que coincide con una
   membresía real del usuario autenticado.
3. Un usuario puede pertenecer a varias organizaciones (`Membership` N:M); el cambio de
   organización activa es una acción explícita de UI, no un parámetro implícito de request.
4. Las rutas y guards de superadministración son un módulo aparte, con su propio control de acceso
   y auditoría, y no comparten camino de autorización con las rutas de organización.
5. **Definición de terminado**: ningún módulo con datos comerciales se considera completo sin un
   test de integración que demuestre que una organización A no puede leer ni escribir datos de una
   organización B a través de ningún endpoint expuesto.

## Alternativas consideradas

- **Aislamiento por base de datos o esquema separado por tenant**: descartado para el MVP — añade
  complejidad operativa (migraciones N veces, pooling de conexiones) desproporcionada al estadio
  actual del producto. Se revisará si un cliente enterprise exige aislamiento físico.
- **Confiar en el `organization_id` enviado por el frontend con validación superficial**:
  descartado explícitamente — es la causa más común de fugas de datos multi-tenant.

## Consecuencias

- Positivo: un único modelo de datos y una única base de código de autorización simplifican
  auditoría y pruebas.
- Positivo: permite migrar a aislamiento físico más adelante sin cambiar el modelo lógico, solo la
  capa de infraestructura.
- Negativo: requiere disciplina constante — cada nuevo endpoint y cada nueva query deben pasar por
  el filtro de organización; se mitiga con guards/interceptors reutilizables en NestJS y revisión
  de código obligatoria en cada PR que toque datos comerciales.
- Seguimiento: el checklist de "definición de terminado" (`02_STACK_...md` §21) debe incluir
  explícitamente la prueba de aislamiento como criterio de aceptación para cualquier módulo nuevo.
