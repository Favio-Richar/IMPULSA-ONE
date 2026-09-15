import { AsyncLocalStorage } from "node:async_hooks";

// Correlación de logs por request (F1.10). `traceId` viaja entre servicios (api -> worker) cuando
// uno encola un job para el otro; `requestId` es propio de cada request/proceso HTTP individual.
export interface RequestContext {
  requestId: string;
  traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
