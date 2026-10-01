// Contratos de respuesta de la API (`/api/v1`), compartidos entre el backend y los frontends.
//
// Solo describen **respuestas**. Los cuerpos de petición ya tienen su fuente de verdad en los
// esquemas Zod que los validan (`apps/api/**/dto` y `@impulza/validation`), y el documento OpenAPI
// los deriva de ahí: duplicarlos acá sería crear una segunda versión que puede mentir.
//
// Que estos esquemas describan la realidad no se supone — se prueba: las pruebas e2e de `apps/api`
// parsean respuestas reales contra ellos, así que un cambio de forma en un servicio rompe el
// contrato antes de llegar a un cliente.
export * from "./primitives.js";
export * from "./auth.js";
export * from "./health.js";
export * from "./organizations.js";
export * from "./public.js";
export * from "./sites.js";
export * from "./ai.js";
export * from "./themes.js";
export * from "./templates.js";
export * from "./forms.js";
export * from "./contacts.js";
export * from "./short-links.js";
export * from "./analytics.js";
export * from "./plans.js";
export * from "./admin.js";
export * from "./support.js";
export * from "./media.js";
export * from "./domains.js";
export * from "./bookings.js";
export * from "./catalog.js";
export * from "./campaigns.js";
export * from "./ab-tests.js";
export * from "./smart-cta.js";
export * from "./automations.js";
export * from "./billing.js";
export * from "./payment-accounts.js";
export * from "./webhooks.js";
export * from "./newsletter.js";
export * from "./sequences.js";
export * from "./funnels.js";
export * from "./page-campaigns.js";
export * from "./coupons.js";
