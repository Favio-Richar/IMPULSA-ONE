import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Secuencias de correo (F7.5, ADR-020).

export const emailSequenceStepResponse = z.object({
  position: z.number().int(),
  delayHours: z.number().int(),
  subject: z.string(),
  bodyHtml: z.string(),
});

export const emailSequenceResponse = z.object({
  id: uuid,
  name: z.string(),
  trigger: z.string(),
  enabled: z.boolean(),
  steps: z.array(emailSequenceStepResponse),
  stats: z.object({
    active: z.number().int(),
    completed: z.number().int(),
    stopped: z.number().int(),
    sentLast30Days: z.number().int(),
  }),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Una inscripción para el registro: avance y estado; el contacto, con nombre y correo (lo ve el equipo). */
export const emailSequenceEnrollmentResponse = z.object({
  id: uuid,
  contact: z.object({ id: uuid, name: z.string().nullable(), email: z.string().nullable() }),
  status: z.enum(["ACTIVE", "COMPLETED", "STOPPED"]),
  stopReason: z.string().nullable(),
  /** Correos ya enviados. */
  sentSteps: z.number().int(),
  nextStep: z.number().int(),
  nextSendAt: isoDateTime.nullable(),
  enrolledAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});

export type EmailSequenceResponse = z.infer<typeof emailSequenceResponse>;
export type EmailSequenceStepResponse = z.infer<typeof emailSequenceStepResponse>;
export type EmailSequenceEnrollmentResponse = z.infer<typeof emailSequenceEnrollmentResponse>;
