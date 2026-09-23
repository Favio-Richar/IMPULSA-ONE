import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Contratos de enlaces cortos y QR (F3.5).

export const utmResponse = z.object({
  source: z.string().optional(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  term: z.string().optional(),
  content: z.string().optional(),
});

export const shortLinkResponse = z.object({
  id: uuid,
  organizationId: uuid,
  slug: z.string(),
  destinationUrl: z.string(),
  utm: utmResponse.nullable(),
  clickCountCached: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Resuelto y autocontenido: guarda el preset completo elegido del catálogo cerrado (F3.5), no
 *  solo la clave — así el cliente no necesita el catálogo aparte para pintar el QR. */
export const qrStyleResponse = z.object({
  key: z.string(),
  foreground: z.string(),
  background: z.string(),
});

export const qrCodeResponse = z.object({
  id: uuid,
  organizationId: uuid,
  shortLinkId: uuid.nullable(),
  directUrl: z.string().nullable(),
  styleConfig: qrStyleResponse,
  scanCountCached: z.number().int(),
  createdAt: isoDateTime,
});

export type UtmResponse = z.infer<typeof utmResponse>;
export type ShortLinkResponse = z.infer<typeof shortLinkResponse>;
export type QrStyleResponse = z.infer<typeof qrStyleResponse>;
export type QrCodeResponse = z.infer<typeof qrCodeResponse>;
