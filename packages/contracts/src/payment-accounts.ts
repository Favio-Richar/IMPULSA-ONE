import { z } from "zod";
import { isoDateTime } from "./primitives.js";

// Cuenta de cobro del negocio (F5.8, ADR-013). Nunca tokens ni ids internos de la pasarela.

export const paymentAccountsResponse = z.object({
  /** Si este ambiente permite conectar Mercado Pago (Impulza tiene su aplicación configurada). */
  available: z.boolean(),
  /** Si quien pregunta puede conectar o desconectar (`payments.connect`, solo el dueño). */
  canManage: z.boolean(),
  mercadoPago: z
    .object({
      status: z.enum(["CONNECTED", "ERROR"]),
      /** `false`: credenciales de prueba de Mercado Pago (no mueven dinero real). */
      liveMode: z.boolean(),
      connectedAt: isoDateTime,
      expiresAt: isoDateTime,
    })
    .nullable(),
  /** Webpay Plus con las credenciales del propio negocio (ADR-030). Nunca la llave ni el código completo. */
  webpayPlus: z
    .object({
      status: z.enum(["CONNECTED", "ERROR"]),
      /** `false`: ambiente de integración de Transbank (no mueve dinero real). */
      liveMode: z.boolean(),
      /** Últimos 4 dígitos del código de comercio, para que el dueño reconozca cuál conectó. */
      commerceCodeLast4: z.string(),
      connectedAt: isoDateTime,
    })
    .nullable(),
});

export const paymentAccountConnectResponse = z.object({ url: z.string().url() });

export type PaymentAccountsResponse = z.infer<typeof paymentAccountsResponse>;
export type PaymentAccountConnectResponse = z.infer<typeof paymentAccountConnectResponse>;
