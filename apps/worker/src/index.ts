import { env } from "./env.js";

// Placeholder del worker — el procesamiento asíncrono real (BullMQ: analítica, emails, media,
// webhooks) se agrega cuando exista el primer job concreto, para no depender de una cola vacía
// sin uso (ver ARCHITECTURE.md §3 y docs/BACKLOG_FASE_0_1.md).
console.log(`apps/worker (${env.NODE_ENV}) — en construcción (Fase 0). Sin colas configuradas todavía.`);
