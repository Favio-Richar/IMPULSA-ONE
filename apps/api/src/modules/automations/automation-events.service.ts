import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import { automationJobId, type AutomationEventJob, type AutomationTrigger } from "@impulza/validation";
import type { Queue } from "bullmq";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";

export const AUTOMATION_QUEUE = Symbol("AUTOMATION_QUEUE");

/**
 * Emisor de eventos de automatización (F6.7). Se llama **después** de confirmar lo que pasó (un
 * contacto, una reserva o un pedido ya guardados). Solo encola ids; el worker lee los datos al
 * procesar. Nunca lanza: una automatización no puede hacer fallar una reserva o un pedido.
 */
@Injectable()
export class AutomationEventsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTOMATION_QUEUE) private readonly queue: Queue<AutomationEventJob>,
  ) {}

  async emit(input: { organizationId: string; trigger: AutomationTrigger; subjectId: string; contactId: string | null }): Promise<void> {
    try {
      // Sin automatizaciones encendidas para ese disparador, no se encola nada.
      const active = await this.prisma.automation.count({ where: { organizationId: input.organizationId, trigger: input.trigger, enabled: true } });
      if (active === 0) {
        return;
      }
      const job: AutomationEventJob = { ...input, occurredAt: new Date().toISOString() };
      await this.queue.add(input.trigger, job, {
        // El mismo evento encolado dos veces (reintento de la petición) es un solo trabajo; la
        // garantía definitiva es el índice único de `automation_runs`.
        // BullMQ no admite `:` en un id propio: `automation-<disparador>-<id>`.
        jobId: automationJobId(input.trigger, input.subjectId),
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      });
    } catch (error) {
      logger.error("No se pudo encolar un evento de automatización", { trigger: input.trigger, err: error });
    }
  }
}
