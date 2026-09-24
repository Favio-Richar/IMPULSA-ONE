// Token de inyección de la cola BullMQ de analítica (F3.6). En archivo propio para que módulo y
// servicio no se importen mutuamente.
export const ANALYTICS_QUEUE = Symbol("ANALYTICS_QUEUE");
