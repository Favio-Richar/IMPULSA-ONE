import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { type CheckoutPayment, PaymentGatewayError } from "@impulza/payments";
import type { Redis } from "ioredis";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { MERCADO_PAGO_CHECKOUT, type CheckoutConfig } from "./checkout.tokens.js";
import { PaymentAccountsService } from "./payment-accounts.service.js";

/** Un reembolso a la vez por pago; el candado vence solo si el proceso muere a mitad. */
const LOCK_TTL_SECONDS = 60;

export const REFUND_IN_PROGRESS = "Ya hay una devolución en curso para este pago. Espera un momento y recarga.";
export const REFUND_UNAVAILABLE = "La cuenta de Mercado Pago del negocio no está conectada: la devolución se hace desde tu cuenta de Mercado Pago.";

/**
 * Reembolsos de los cobros de un negocio (F5.11a, ADR-013), con **su** token. Lo usan pedidos y
 * señas. Doble protección contra devolver dos veces: un candado en Redis por pago (dos clics o dos
 * personas a la vez) y la clave de idempotencia de Mercado Pago (una respuesta perdida que se
 * reintenta). Después de devolver se vuelve a leer el pago: lo devuelto y el estado salen siempre de
 * Mercado Pago, nunca de una cuenta propia.
 */
@Injectable()
export class CheckoutRefundsService {
  constructor(
    @Inject(MERCADO_PAGO_CHECKOUT) private readonly config: CheckoutConfig | null,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly accounts: PaymentAccountsService,
  ) {}

  /**
   * Devuelve dinero de un pago bajo un candado por pago. Todo el ciclo ocurre con el candado tomado:
   * `prepare` vuelve a leer lo que queda por devolver y decide monto y clave de idempotencia (así dos
   * clics no validan contra una lectura vieja), y `apply` guarda lo que informa Mercado Pago antes de
   * soltarlo (la siguiente petición ya ve lo devuelto).
   */
  async refund<T>(input: {
    organizationId: string;
    paymentId: string;
    prepare: () => Promise<{ amount: number; idempotencyKey: string }>;
    apply: (payment: CheckoutPayment, amount: number) => Promise<T>;
  }): Promise<T> {
    const account = await this.accounts.chargingAccountFor(input.organizationId);
    if (!account || !this.config) {
      throw new UnprocessableEntityException({ code: "PAYMENTS_UNAVAILABLE", message: REFUND_UNAVAILABLE });
    }
    const lockKey = `refund-lock:${input.paymentId}`;
    const token = randomUUID();
    const locked = await this.redis.set(lockKey, token, "EX", LOCK_TTL_SECONDS, "NX");
    if (locked !== "OK") throw new ConflictException(REFUND_IN_PROGRESS);
    try {
      const { amount, idempotencyKey } = await input.prepare();
      let payment: CheckoutPayment;
      try {
        await this.config.checkout.refundPayment(account.accessToken, input.paymentId, amount, idempotencyKey);
        payment = await this.config.checkout.getPayment(account.accessToken, input.paymentId);
      } catch (error) {
        const code = error instanceof PaymentGatewayError ? error.code : "unknown";
        logger.warn("pagos: Mercado Pago no hizo la devolución", { organizationId: input.organizationId, code });
        if (error instanceof PaymentGatewayError && error.retryable) {
          // Reintentar es seguro: la misma clave de idempotencia no devuelve dos veces.
          throw new ServiceUnavailableException("Mercado Pago no respondió. Intenta de nuevo en un momento; no se devolverá dos veces.");
        }
        if (error instanceof PaymentGatewayError) {
          throw new UnprocessableEntityException({ code: "REFUND_REJECTED", message: "Mercado Pago no aceptó la devolución. Revisa el pago en tu cuenta de Mercado Pago." });
        }
        throw error;
      }
      return await input.apply(payment, amount);
    } finally {
      // Solo se suelta el candado propio (si venció y lo tomó otra petición, no se le quita).
      if ((await this.redis.get(lockKey)) === token) {
        await this.redis.del(lockKey);
      }
    }
  }
}

/** Estados de un pago que avisan al negocio de un problema (F5.11a). */
export const DISPUTE_STATUSES = new Set(["charged_back", "in_mediation"]);
