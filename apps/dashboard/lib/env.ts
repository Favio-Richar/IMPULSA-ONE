import { z } from "zod";

// Next.js inlina las variables NEXT_PUBLIC_* en el bundle de cliente en build time — no puede
// pasar por packages/config (pensado para Node puro), pero se valida igual de estricto.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  // Origen público de apps/web (F3.5): para armar la URL corta/QR que se muestra al usuario
  // (`{NEXT_PUBLIC_WEB_BASE_URL}/s/:slug`, `.../qr/:qrCodeId`) — nunca se adivina del `window.location`
  // del panel, que corre en un dominio distinto al sitio público.
  NEXT_PUBLIC_WEB_BASE_URL: z.url(),
  // Enlace externo para pedir un cambio de plan (F4.3) mientras no haya cobro en línea (F4.6,
  // bloqueada por la decisión #5): el "enlace externo de pago" del MVP de ST §12. Opcional; sin él,
  // la pantalla de planes lo dice en vez de mostrar un botón que no lleva a ninguna parte. Solo
  // https:// o mailto: — nunca un esquema que ejecute algo.
  NEXT_PUBLIC_PLAN_UPGRADE_URL: z
    .string()
    .refine((value) => /^(https:\/\/|mailto:)/.test(value), "Debe empezar con https:// o mailto:")
    .optional(),
});

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WEB_BASE_URL: process.env.NEXT_PUBLIC_WEB_BASE_URL,
  NEXT_PUBLIC_PLAN_UPGRADE_URL: process.env.NEXT_PUBLIC_PLAN_UPGRADE_URL || undefined,
});
