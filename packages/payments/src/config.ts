import { z } from "zod";
import type { WebpayOneclickConfig } from "./webpay-oneclick.js";

// Variables de entorno de las pasarelas (ADR-012), compartidas por `apps/api` y `apps/worker`: las
// dos leen el mismo `.env` y deben entender lo mismo. Todas opcionales — sin ellas la pasarela no
// se ofrece y nada más se rompe —, pero **todas o ninguna**: una configuración a medias detiene el
// arranque (ST §15) en vez de fallar recién con el primer cliente pagando.

export const webpayEnvShape = {
  WEBPAY_ENVIRONMENT: z.enum(["integration", "production"]).optional(),
  WEBPAY_COMMERCE_CODE: z.string().regex(/^\d{12}$/, "12 dígitos").optional(),
  WEBPAY_CHILD_COMMERCE_CODE: z.string().regex(/^\d{12}$/, "12 dígitos").optional(),
  WEBPAY_API_KEY_SECRET: z.string().min(32).optional(),
};

type WebpayEnv = { [K in keyof typeof webpayEnvShape]?: z.infer<(typeof webpayEnvShape)[K]> };

export function webpayConfigFromEnv(env: WebpayEnv): WebpayOneclickConfig | null {
  const values = [env.WEBPAY_ENVIRONMENT, env.WEBPAY_COMMERCE_CODE, env.WEBPAY_CHILD_COMMERCE_CODE, env.WEBPAY_API_KEY_SECRET];
  const present = values.filter((value) => value !== undefined).length;
  if (present === 0) return null;
  if (present !== values.length) {
    throw new Error(
      "Configuración de Webpay incompleta: define WEBPAY_ENVIRONMENT, WEBPAY_COMMERCE_CODE, WEBPAY_CHILD_COMMERCE_CODE y WEBPAY_API_KEY_SECRET, o ninguna.",
    );
  }
  return {
    environment: env.WEBPAY_ENVIRONMENT!,
    commerceCode: env.WEBPAY_COMMERCE_CODE!,
    childCommerceCode: env.WEBPAY_CHILD_COMMERCE_CODE!,
    apiKeySecret: env.WEBPAY_API_KEY_SECRET!,
  };
}
