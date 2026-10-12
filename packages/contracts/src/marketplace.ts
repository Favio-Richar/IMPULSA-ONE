import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Marketplace de integraciones y plantillas (F10.6, ADR-029).

export const marketplaceKind = z.enum(["TEMPLATE", "INTEGRATION"]);
export const marketplaceStatus = z.enum(["IN_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]);

/** Lo que cualquiera puede ver de una publicación aprobada. */
export const marketplaceListingPublicResponse = z.object({
  id: uuid,
  kind: marketplaceKind,
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  partnerName: z.string(),
  partnerUrl: z.string().nullable(),
  version: z.string(),
  /** Qué pide, en palabras del usuario (derivado de los datos). */
  permissions: z.array(z.string()),
  /** Solo integraciones: los eventos que recibe. */
  events: z.array(z.string()),
  /** Solo integraciones: cómo conectarla. */
  instructions: z.string().nullable(),
});

export const publicMarketplaceResponse = z.object({ items: z.array(marketplaceListingPublicResponse) });

/** Para el panel de una organización: el directorio con el estado de instalación de ESTA organización. */
export const marketplaceInstallState = z.object({
  installed: z.boolean(),
  installedVersion: z.string().nullable(),
  /** La publicación tiene una versión distinta de la instalada. */
  updateAvailable: z.boolean(),
});

export const marketplaceOrganizationListingResponse = marketplaceListingPublicResponse.extend({ install: marketplaceInstallState });

/** Una publicación propia (socio): con su estado y, si se rechazó o retiró, el motivo. */
export const marketplaceSubmissionResponse = marketplaceListingPublicResponse.extend({
  status: marketplaceStatus,
  reviewReason: z.string().nullable(),
  installs: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const marketplaceOrganizationResponse = z.object({
  directory: z.array(marketplaceOrganizationListingResponse),
  submissions: z.array(marketplaceSubmissionResponse),
});

export const marketplaceInstallResponse = z.object({
  listingId: uuid,
  version: z.string(),
  /** Solo al instalar una integración: la clave con que se firman los envíos (se muestra una sola vez). */
  secret: z.string().nullable(),
});

export const adminMarketplaceListingResponse = marketplaceSubmissionResponse.extend({
  submittedByOrganization: z.object({ id: uuid, name: z.string() }).nullable(),
});
export const adminMarketplaceListResponse = z.object({ items: z.array(adminMarketplaceListingResponse) });

export type MarketplaceListingPublicResponse = z.infer<typeof marketplaceListingPublicResponse>;
export type PublicMarketplaceResponse = z.infer<typeof publicMarketplaceResponse>;
export type MarketplaceOrganizationResponse = z.infer<typeof marketplaceOrganizationResponse>;
export type MarketplaceSubmissionResponse = z.infer<typeof marketplaceSubmissionResponse>;
export type MarketplaceInstallResponse = z.infer<typeof marketplaceInstallResponse>;
export type AdminMarketplaceListingResponse = z.infer<typeof adminMarketplaceListingResponse>;
export type AdminMarketplaceListResponse = z.infer<typeof adminMarketplaceListResponse>;
