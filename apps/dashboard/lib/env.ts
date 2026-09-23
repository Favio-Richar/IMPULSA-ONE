import { z } from "zod";

// Next.js inlina las variables NEXT_PUBLIC_* en el bundle de cliente en build time — no puede
// pasar por packages/config (pensado para Node puro), pero se valida igual de estricto.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  // Origen público de apps/web (F3.5): para armar la URL corta/QR que se muestra al usuario
  // (`{NEXT_PUBLIC_WEB_BASE_URL}/s/:slug`, `.../qr/:qrCodeId`) — nunca se adivina del `window.location`
  // del panel, que corre en un dominio distinto al sitio público.
  NEXT_PUBLIC_WEB_BASE_URL: z.url(),
});

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WEB_BASE_URL: process.env.NEXT_PUBLIC_WEB_BASE_URL,
});
