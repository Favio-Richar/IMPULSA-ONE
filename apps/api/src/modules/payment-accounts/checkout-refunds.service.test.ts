import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { CheckoutPayment, MercadoPagoCheckoutLike } from "@impulza/payments";
import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { CheckoutRefundsService } from "./checkout-refunds.service.js";
import type { PaymentAccountsService } from "./payment-accounts.service.js";

// Orden del ciclo de devolución bajo el candado (F5.11a, ADR-013; endurecido en F7.8a): releer el
// saldo, devolver y guardar ocurren con el candado tomado, así una segunda petición nunca valida
// contra una lectura vieja. Determinista, sin red ni base.

function fakeRedis(log: string[]) {
  const store = new Map<string, string>();
  const redis = {
    async set(key: string, value: string, _ex: string, _ttl: number, mode: string) {
      if (mode === "NX" && store.has(key)) return null;
      store.set(key, value);
      log.push("candado");
      return "OK";
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async del(key: string) {
      store.delete(key);
      log.push("suelta");
      return 1;
    },
  };
  return { redis: redis as unknown as Redis, store };
}

const payment: CheckoutPayment = {
  id: "1",
  status: "refunded",
  externalReference: "x",
  collectorId: "c",
  amount: 1000,
  currency: "CLP",
  refundedAmount: 1000,
} as unknown as CheckoutPayment;

function service(log: string[], options: { refundFails?: boolean } = {}) {
  const { redis, store } = fakeRedis(log);
  const checkout = {
    async refundPayment() {
      log.push("devuelve");
      if (options.refundFails) throw new Error("caída");
    },
    async getPayment() {
      log.push("lee pago");
      return payment;
    },
  } as unknown as MercadoPagoCheckoutLike;
  const accounts = { chargingAccountFor: async () => ({ accessToken: "tok", providerUserId: "c", liveMode: false }) } as unknown as PaymentAccountsService;
  return { refunds: new CheckoutRefundsService({ checkout, webhookSecret: "s" }, redis, accounts), store };
}

describe("devoluciones bajo candado", () => {
  it("relee el saldo, devuelve y guarda con el candado tomado, y recién después lo suelta", async () => {
    const log: string[] = [];
    const { refunds } = service(log);
    const result = await refunds.refund({
      organizationId: "o",
      paymentId: "p",
      prepare: async () => {
        log.push("relee");
        return { amount: 1000, idempotencyKey: "k" };
      },
      apply: async (_payment, amount) => {
        log.push(`guarda ${amount}`);
        return "listo";
      },
    });
    expect(result).toBe("listo");
    expect(log).toEqual(["candado", "relee", "devuelve", "lee pago", "guarda 1000", "suelta"]);
  });

  it("una segunda petición mientras la primera trabaja recibe 409 sin leer ni devolver nada", async () => {
    const log: string[] = [];
    const { refunds } = service(log);
    let second: Promise<unknown> | null = null;
    await refunds.refund({
      organizationId: "o",
      paymentId: "p",
      prepare: async () => {
        second = refunds.refund({
          organizationId: "o",
          paymentId: "p",
          prepare: async () => {
            log.push("relee la segunda");
            return { amount: 1, idempotencyKey: "k2" };
          },
          apply: async () => null,
        });
        await expect(second).rejects.toBeInstanceOf(ConflictException);
        return { amount: 1000, idempotencyKey: "k" };
      },
      apply: async () => null,
    });
    expect(second).not.toBeNull();
    expect(log).not.toContain("relee la segunda");
    expect(log.filter((entry) => entry === "devuelve")).toHaveLength(1);
  });

  it("si el saldo ya no alcanza, no llama a Mercado Pago y suelta el candado", async () => {
    const log: string[] = [];
    const { refunds, store } = service(log);
    await expect(
      refunds.refund({
        organizationId: "o",
        paymentId: "p",
        prepare: async () => {
          throw new UnprocessableEntityException("nada que devolver");
        },
        apply: async () => null,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(log).toEqual(["candado", "suelta"]);
    expect(store.size).toBe(0);
  });

  it("si Mercado Pago falla, no guarda nada y suelta el candado; nunca suelta uno ajeno", async () => {
    const log: string[] = [];
    const { refunds, store } = service(log, { refundFails: true });
    await expect(
      refunds.refund({ organizationId: "o", paymentId: "p", prepare: async () => ({ amount: 1, idempotencyKey: "k" }), apply: async () => log.push("guarda") }),
    ).rejects.toThrow();
    expect(log).not.toContain("guarda");
    expect(store.size).toBe(0);

    // El candado venció y lo tomó otra petición: al terminar, esta no se lo quita.
    const ajeno: string[] = [];
    const other = service(ajeno);
    await other.refunds.refund({
      organizationId: "o",
      paymentId: "p",
      prepare: async () => {
        other.store.set("refund-lock:p", "otra-peticion");
        return { amount: 1, idempotencyKey: "k" };
      },
      apply: async () => null,
    });
    expect(other.store.get("refund-lock:p")).toBe("otra-peticion");
  });
});
