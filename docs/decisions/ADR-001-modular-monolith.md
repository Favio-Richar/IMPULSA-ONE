# ADR-001: Monolito modular sobre microservicios para el MVP

- **Estado:** Aceptado
- **Fecha:** 2026-09-14
- **Fuente:** `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §3.1, §22

## Contexto

Impulza One es un SaaS multi-tenant con más de 20 dominios funcionales previstos (auth, sites,
pages, blocks, forms, contacts, analytics, domains, billing, y en fases posteriores bookings,
catalog, orders, payments, campaigns, ai-assistant, agency). Construir esto como microservicios
desde el día uno multiplicaría la complejidad operativa (despliegue, observabilidad, comunicación
entre servicios) antes de tener validación de producto o tráfico que lo justifique.

## Decisión

Construir un **monolito modular** dentro de un **monorepo** (pnpm workspaces + Turborepo):

- Una API NestJS única (`apps/api`) que contiene todos los módulos de dominio.
- Cada módulo de dominio se organiza internamente como `controller → application
  service/use case → domain → repository/adapter`, de forma que quede desacoplado del resto y
  pueda extraerse a un servicio independiente en el futuro si el escalamiento real lo exige.
- Aplicaciones desplegables separadas para las distintas superficies (`web`, `dashboard`, `admin`,
  `api`, `worker`), pero un solo backend de reglas de negocio.
- Trabajo asíncrono vía BullMQ/Redis dentro del mismo monolito, no vía colas entre microservicios.

## Alternativas consideradas

- **Microservicios desde el inicio**: descartado — mayor costo operativo, más puntos de fallo,
  necesidad de orquestación (Kubernetes) explícitamente fuera de alcance del MVP, y no hay
  evidencia de necesidad de escalar componentes de forma independiente todavía.
- **Monolito no modular** (todo acoplado sin separación de dominios): descartado — dificultaría
  tanto el mantenimiento a mediano plazo como una eventual extracción futura.

## Consecuencias

- Positivo: velocidad de desarrollo, despliegue simple (una imagen de API), más fácil de razonar y
  probar el aislamiento multi-tenant en un solo lugar.
- Positivo: la separación interna por módulo permite decisiones futuras de extracción sin
  reescritura completa.
- Negativo: si un módulo requiere escalar de forma muy distinta al resto (p. ej. analítica de alto
  volumen), no lo puede hacer de forma independiente hasta que se decida extraerlo.
- Seguimiento: si en producción algún módulo (probablemente `analytics` o `worker`) satura
  recursos compartidos, evaluar su extracción como ADR posterior — no antes.

## Restricciones asociadas

No introducir Kubernetes, Kafka, ni frameworks de microservicios en el MVP. Esta decisión se
revisa solo cuando exista necesidad de escala medida, no de forma especulativa.
