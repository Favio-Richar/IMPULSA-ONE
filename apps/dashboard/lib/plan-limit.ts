import { ApiError } from "./api-client";

/** Lo que el servidor manda cuando una alta supera el límite del plan (F4.2): 402 con
 *  `code: "PLAN_LIMIT_REACHED"`. Se reconoce por el código, nunca interpretando el mensaje. */
export interface PlanLimitInfo {
  message: string;
  key: string;
  max: number;
  used: number;
  planName: string;
}

export function getPlanLimitInfo(error: unknown): PlanLimitInfo | null {
  if (!(error instanceof ApiError) || error.status !== 402) {
    return null;
  }
  const body = error.body as
    | { code?: unknown; message?: unknown; limit?: { key?: unknown; max?: unknown; used?: unknown }; plan?: { name?: unknown } }
    | undefined;
  if (body?.code !== "PLAN_LIMIT_REACHED") {
    return null;
  }
  return {
    message: typeof body.message === "string" ? body.message : "Llegaste a un límite de tu plan.",
    key: typeof body.limit?.key === "string" ? body.limit.key : "",
    max: typeof body.limit?.max === "number" ? body.limit.max : 0,
    used: typeof body.limit?.used === "number" ? body.limit.used : 0,
    planName: typeof body.plan?.name === "string" ? body.plan.name : "actual",
  };
}
