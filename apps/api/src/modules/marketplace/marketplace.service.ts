import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  AdminMarketplaceListingResponse,
  MarketplaceInstallResponse,
  MarketplaceListingPublicResponse,
  MarketplaceOrganizationResponse,
  MarketplaceSubmissionResponse,
  PublicMarketplaceResponse,
} from "@impulza/contracts";
import { MarketplaceListingKind, MarketplaceListingStatus, Prisma, type MarketplaceListing, type PrismaClient } from "@impulza/database";
import {
  courseSlugFromTitle,
  listingPermissions,
  MARKETPLACE_INSTALLS_PER_ORGANIZATION_MAX,
  MARKETPLACE_SUBMISSIONS_PER_ORGANIZATION_MAX,
  PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX,
  privateTemplateCode,
  stripOrganizationReferences,
  templateDefinitionFor,
  type InstallListingDto,
  type ListMarketplaceQuery,
  type SubmitListingDto,
  type WebhookEventType,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { sanitizeBlockConfig } from "../blocks/sanitize.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";

const LISTING_NOT_FOUND = "Publicación no encontrada.";

const unprocessable = (code: string, message: string) => new UnprocessableEntityException({ statusCode: 422, error: "Unprocessable Entity", code, message });
const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, error: "Conflict", code, message });

interface TemplatePayload {
  template: { themeCode: string; industryTags: string[]; objectiveTags: string[]; blocksSeed: unknown[] };
}
interface IntegrationPayload {
  events: WebhookEventType[];
  instructions?: string | null;
}

/**
 * Marketplace de integraciones y plantillas (F10.6, ADR-029 §6). Lo publicado es DATO declarativo y revisado:
 * - una plantilla del catálogo cerrado de bloques (sin HTML ni JavaScript; se vuelve a validar y a limpiar de referencias al instalar);
 * - un conector de eventos hacia una dirección que pone quien instala (misma protección SSRF y firma que los webhooks del panel).
 * Nada se ejecuta en páginas públicas y no hay cobro ni custodia de dinero. Un listado sin aprobar es invisible; retirarlo desinstala.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  // ───────────────────────────── Presentación ─────────────────────────────

  private publicView(row: MarketplaceListing): MarketplaceListingPublicResponse {
    const integration = row.kind === MarketplaceListingKind.INTEGRATION ? (row.payload as unknown as IntegrationPayload) : null;
    return {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      description: row.description,
      partnerName: row.partnerName,
      partnerUrl: row.partnerUrl,
      version: row.version,
      permissions: row.permissions,
      events: integration?.events ?? [],
      instructions: integration?.instructions ?? null,
    };
  }

  private submissionView(row: MarketplaceListing, installs: number): MarketplaceSubmissionResponse {
    return { ...this.publicView(row), status: row.status, reviewReason: row.reviewReason, installs, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private async installCounts(listingIds: string[]): Promise<Map<string, number>> {
    if (listingIds.length === 0) return new Map();
    const groups = await this.prisma.marketplaceInstall.groupBy({ by: ["listingId"], where: { listingId: { in: listingIds } }, _count: { _all: true } });
    return new Map(groups.map((group) => [group.listingId, group._count._all]));
  }

  // ───────────────────────────── Directorio ─────────────────────────────

  /** Directorio público: solo lo aprobado. Nada del contenido interno (la plantilla completa) sale por aquí. */
  async publicDirectory(): Promise<PublicMarketplaceResponse> {
    const rows = await this.prisma.marketplaceListing.findMany({ where: { status: MarketplaceListingStatus.APPROVED }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
    return { items: rows.map((row) => this.publicView(row)) };
  }

  async organizationView(organizationId: string): Promise<MarketplaceOrganizationResponse> {
    const [approved, installs, own] = await Promise.all([
      this.prisma.marketplaceListing.findMany({ where: { status: MarketplaceListingStatus.APPROVED }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
      this.prisma.marketplaceInstall.findMany({ where: { organizationId }, select: { listingId: true, version: true } }),
      this.prisma.marketplaceListing.findMany({ where: { submittedByOrganizationId: organizationId }, orderBy: { createdAt: "desc" } }),
    ]);
    const installed = new Map(installs.map((install) => [install.listingId, install.version]));
    const counts = await this.installCounts(own.map((row) => row.id));
    return {
      directory: approved.map((row) => {
        const version = installed.get(row.id) ?? null;
        return { ...this.publicView(row), install: { installed: version !== null, installedVersion: version, updateAvailable: version !== null && version !== row.version } };
      }),
      submissions: own.map((row) => this.submissionView(row, counts.get(row.id) ?? 0)),
    };
  }

  // ───────────────────────────── Instalar ─────────────────────────────

  async install(organizationId: string, actorId: string, listingId: string, dto: InstallListingDto): Promise<MarketplaceInstallResponse> {
    const listing = await this.prisma.marketplaceListing.findFirst({ where: { id: listingId, status: MarketplaceListingStatus.APPROVED } });
    // Lo que no está aprobado no existe para quien instala.
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    if (await this.prisma.marketplaceInstall.findUnique({ where: { organizationId_listingId: { organizationId, listingId } } })) {
      throw conflict("ALREADY_INSTALLED", "Ya la tienes instalada.");
    }
    if ((await this.prisma.marketplaceInstall.count({ where: { organizationId } })) >= MARKETPLACE_INSTALLS_PER_ORGANIZATION_MAX) {
      throw unprocessable("INSTALL_LIMIT", `Una organización puede tener hasta ${MARKETPLACE_INSTALLS_PER_ORGANIZATION_MAX} instalaciones: quita alguna antes.`);
    }
    return listing.kind === MarketplaceListingKind.TEMPLATE
      ? this.installTemplate(organizationId, actorId, listing)
      : this.installIntegration(organizationId, actorId, listing, dto);
  }

  private async installTemplate(organizationId: string, actorId: string, listing: MarketplaceListing): Promise<MarketplaceInstallResponse> {
    const payload = listing.payload as unknown as TemplatePayload;
    const blocksSeed = payload.template.blocksSeed.map((block) => {
      const seed = block as { type: string; config?: unknown };
      // Sin referencias a otra organización y con el texto enriquecido saneado, igual que al guardar un bloque en el constructor.
      return { ...seed, config: sanitizeBlockConfig(seed.type, stripOrganizationReferences(seed.config ?? {})) };
    });
    const parsed = templateDefinitionFor(
      { name: listing.name, description: listing.summary, template: { ...payload.template, blocksSeed } },
      privateTemplateCode(organizationId, listing.name, randomBytes(4).toString("hex")),
    );
    if (!parsed.success) throw unprocessable("TEMPLATE_INVALID", "La plantilla ya no cumple el catálogo de bloques y no se puede instalar.");

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`private-templates:${organizationId}`}, 0))`;
        if ((await tx.template.count({ where: { organizationId } })) >= PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX) {
          throw conflict("TEMPLATE_LIMIT", `Una organización puede tener hasta ${PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX} plantillas propias: borra alguna antes de instalar otra.`);
        }
        const template = await tx.template.create({
          data: {
            organizationId,
            code: parsed.data.code,
            name: parsed.data.name,
            description: parsed.data.description,
            industryTags: parsed.data.industryTags,
            objectiveTags: parsed.data.objectiveTags,
            themeCode: parsed.data.themeCode,
            family: parsed.data.family,
            previewImageUrl: null,
            blocksSeed: parsed.data.blocksSeed as Prisma.InputJsonValue,
            sortOrder: 0,
            isActive: true,
            isFeatured: false,
          },
        });
        await tx.marketplaceInstall.create({
          data: { organizationId, listingId: listing.id, version: listing.version, config: { templateId: template.id }, installedById: actorId },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("ALREADY_INSTALLED", "Ya la tienes instalada.");
      throw error;
    }
    await this.audit.record({ organizationId, actorId, action: "marketplace.installed", targetType: "MarketplaceListing", targetId: listing.id, metadata: { kind: "TEMPLATE", name: listing.name, version: listing.version } });
    return { listingId: listing.id, version: listing.version, secret: null };
  }

  private async installIntegration(organizationId: string, actorId: string, listing: MarketplaceListing, dto: InstallListingDto): Promise<MarketplaceInstallResponse> {
    if (!dto.webhookUrl) {
      throw unprocessable("DESTINATION_REQUIRED", "Pega la dirección de destino que te dio la otra herramienta para conectar esta integración.");
    }
    const payload = listing.payload as unknown as IntegrationPayload;
    // Mismas reglas que un destino creado a mano: límite, URL libre, protección contra direcciones internas y firma con secreto.
    const created = await this.webhooks.create(organizationId, actorId, {
      url: dto.webhookUrl,
      description: `Integración: ${listing.name}`.slice(0, 120),
      events: payload.events,
    });
    try {
      await this.prisma.marketplaceInstall.create({
        data: { organizationId, listingId: listing.id, version: listing.version, config: { endpointId: created.endpoint.id }, installedById: actorId },
      });
    } catch (error) {
      // No dejar un destino huérfano si la instalación no quedó registrada.
      await this.webhooks.remove(organizationId, actorId, created.endpoint.id).catch(() => undefined);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("ALREADY_INSTALLED", "Ya la tienes instalada.");
      throw error;
    }
    await this.audit.record({ organizationId, actorId, action: "marketplace.installed", targetType: "MarketplaceListing", targetId: listing.id, metadata: { kind: "INTEGRATION", name: listing.name, version: listing.version, events: payload.events } });
    return { listingId: listing.id, version: listing.version, secret: created.secret };
  }

  /** Quita lo que la instalación creó (la plantilla propia o el destino) y el registro. Lo ya aplicado en páginas no se toca. */
  private async removeInstall(install: { id: string; organizationId: string; listingId: string; config: Prisma.JsonValue }, actorId: string): Promise<void> {
    const config = install.config as { templateId?: string; endpointId?: string };
    if (config.templateId) {
      await this.prisma.template.deleteMany({ where: { id: config.templateId, organizationId: install.organizationId } });
    }
    if (config.endpointId) {
      // Si el destino ya lo borró la persona a mano, no hay nada que quitar.
      await this.webhooks.remove(install.organizationId, actorId, config.endpointId).catch((error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      });
    }
    await this.prisma.marketplaceInstall.delete({ where: { id: install.id } });
  }

  async uninstall(organizationId: string, actorId: string, listingId: string): Promise<void> {
    const install = await this.prisma.marketplaceInstall.findUnique({ where: { organizationId_listingId: { organizationId, listingId } }, include: { listing: { select: { name: true, kind: true } } } });
    if (!install) throw new NotFoundException("No tienes instalada esta publicación.");
    await this.removeInstall(install, actorId);
    await this.audit.record({ organizationId, actorId, action: "marketplace.uninstalled", targetType: "MarketplaceListing", targetId: listingId, metadata: { kind: install.listing.kind, name: install.listing.name } });
  }

  // ───────────────────────────── Socio: publicar ─────────────────────────────

  private async freeSlug(base: string): Promise<string> {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = attempt === 1 ? base : `${base.slice(0, 44)}-${attempt}`;
      if (!(await this.prisma.marketplaceListing.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
    }
    throw conflict("SLUG_TAKEN", "No pudimos armar una dirección libre para la publicación. Cambia el nombre.");
  }

  async submit(organizationId: string, actorId: string, dto: SubmitListingDto): Promise<MarketplaceSubmissionResponse> {
    const alive = await this.prisma.marketplaceListing.count({
      where: { submittedByOrganizationId: organizationId, status: { in: [MarketplaceListingStatus.IN_REVIEW, MarketplaceListingStatus.APPROVED] } },
    });
    if (alive >= MARKETPLACE_SUBMISSIONS_PER_ORGANIZATION_MAX) {
      throw unprocessable("SUBMISSION_LIMIT", `Puedes tener hasta ${MARKETPLACE_SUBMISSIONS_PER_ORGANIZATION_MAX} publicaciones en revisión o aprobadas: retira alguna antes.`);
    }
    let payload: Prisma.InputJsonValue;
    let permissions: string[];
    if (dto.kind === "TEMPLATE") {
      // Sin referencias a otra organización y con el texto enriquecido saneado: lo que se guarda ya es seguro de instalar.
      const blocksSeed = dto.template.blocksSeed.map((block) => ({ ...block, config: sanitizeBlockConfig(block.type, stripOrganizationReferences(block.config ?? {})) }));
      // La definición completa debe cumplir el mismo esquema que el catálogo: si no, no se guarda.
      const parsed = templateDefinitionFor({ name: dto.name, description: dto.summary, template: { ...dto.template, blocksSeed } }, "mkt-validacion");
      if (!parsed.success) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: "Unprocessable Entity",
          code: "TEMPLATE_INVALID",
          message: "La plantilla no cumple el catálogo de bloques.",
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        });
      }
      payload = { template: { themeCode: dto.template.themeCode, industryTags: dto.template.industryTags, objectiveTags: dto.template.objectiveTags, blocksSeed } } as unknown as Prisma.InputJsonValue;
      permissions = listingPermissions({ kind: "TEMPLATE" });
    } else {
      payload = { events: dto.integration.events, instructions: dto.integration.instructions ?? null } as unknown as Prisma.InputJsonValue;
      permissions = listingPermissions({ kind: "INTEGRATION", events: dto.integration.events });
    }
    const slug = await this.freeSlug(courseSlugFromTitle(dto.name));
    let row: MarketplaceListing;
    try {
      row = await this.prisma.marketplaceListing.create({
        data: {
          kind: dto.kind,
          slug,
          name: dto.name,
          summary: dto.summary,
          description: dto.description,
          partnerName: dto.partnerName,
          partnerUrl: dto.partnerUrl ?? null,
          version: dto.version,
          permissions,
          payload,
          status: MarketplaceListingStatus.IN_REVIEW,
          submittedByOrganizationId: organizationId,
          submittedById: actorId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("SLUG_TAKEN", "Ya hay una publicación con ese nombre. Cambia el nombre.");
      throw error;
    }
    await this.audit.record({ organizationId, actorId, action: "marketplace.submitted", targetType: "MarketplaceListing", targetId: row.id, metadata: { kind: row.kind, name: row.name, version: row.version } });
    return this.submissionView(row, 0);
  }

  /** El socio retira su propia publicación: deja de verse y se desinstala de quien la tenía. */
  async withdrawOwn(organizationId: string, actorId: string, listingId: string): Promise<MarketplaceSubmissionResponse> {
    const row = await this.prisma.marketplaceListing.findFirst({ where: { id: listingId, submittedByOrganizationId: organizationId } });
    if (!row) throw new NotFoundException(LISTING_NOT_FOUND);
    if (row.status === MarketplaceListingStatus.WITHDRAWN || row.status === MarketplaceListingStatus.REJECTED) {
      throw conflict("NOT_WITHDRAWABLE", "Esta publicación ya no está activa.");
    }
    const updated = await this.withdrawListing(row, actorId, "Retirada por su publicador.");
    await this.audit.record({ organizationId, actorId, action: "marketplace.withdrawn_by_partner", targetType: "MarketplaceListing", targetId: row.id, metadata: { name: row.name } });
    return this.submissionView(updated, 0);
  }

  // ───────────────────────────── Revisión (superadministración) ─────────────────────────────

  private adminView(row: MarketplaceListing & { _org?: { id: string; name: string } | null }, installs: number): AdminMarketplaceListingResponse {
    return { ...this.submissionView(row, installs), submittedByOrganization: row._org ?? null };
  }

  async adminList(query: ListMarketplaceQuery): Promise<{ items: AdminMarketplaceListingResponse[] }> {
    const rows = await this.prisma.marketplaceListing.findMany({
      where: { ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 200,
    });
    const counts = await this.installCounts(rows.map((row) => row.id));
    const orgIds = [...new Set(rows.map((row) => row.submittedByOrganizationId).filter((id): id is string => id !== null))];
    const orgs = orgIds.length > 0 ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(orgs.map((org) => [org.id, org]));
    return { items: rows.map((row) => this.adminView({ ...row, _org: row.submittedByOrganizationId ? (byId.get(row.submittedByOrganizationId) ?? null) : null }, counts.get(row.id) ?? 0)) };
  }

  private async getListing(listingId: string): Promise<MarketplaceListing> {
    const row = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId } });
    if (!row) throw new NotFoundException(LISTING_NOT_FOUND);
    return row;
  }

  private async detail(listingId: string): Promise<AdminMarketplaceListingResponse> {
    const row = await this.getListing(listingId);
    const org = row.submittedByOrganizationId ? await this.prisma.organization.findUnique({ where: { id: row.submittedByOrganizationId }, select: { id: true, name: true } }) : null;
    const counts = await this.installCounts([row.id]);
    return this.adminView({ ...row, _org: org }, counts.get(row.id) ?? 0);
  }

  async approve(adminId: string, listingId: string): Promise<AdminMarketplaceListingResponse> {
    const row = await this.getListing(listingId);
    // Aprobar también reactiva una retirada (la retirada es reversible); lo rechazado se corrige publicando de nuevo.
    if (row.status !== MarketplaceListingStatus.IN_REVIEW && row.status !== MarketplaceListingStatus.WITHDRAWN) {
      throw conflict("INVALID_STATE", "Esta publicación no se puede aprobar en su estado actual.");
    }
    await this.prisma.marketplaceListing.update({ where: { id: row.id }, data: { status: MarketplaceListingStatus.APPROVED, reviewReason: null, reviewedById: adminId, reviewedAt: new Date() } });
    await this.audit.record({ organizationId: row.submittedByOrganizationId, actorId: adminId, action: "admin.marketplace_approved", targetType: "MarketplaceListing", targetId: row.id, metadata: { name: row.name, version: row.version } });
    return this.detail(row.id);
  }

  async reject(adminId: string, listingId: string, reason: string): Promise<AdminMarketplaceListingResponse> {
    const row = await this.getListing(listingId);
    if (row.status !== MarketplaceListingStatus.IN_REVIEW) throw conflict("INVALID_STATE", "Solo se puede rechazar lo que está en revisión.");
    await this.prisma.marketplaceListing.update({ where: { id: row.id }, data: { status: MarketplaceListingStatus.REJECTED, reviewReason: reason, reviewedById: adminId, reviewedAt: new Date() } });
    await this.audit.record({ organizationId: row.submittedByOrganizationId, actorId: adminId, action: "admin.marketplace_rejected", targetType: "MarketplaceListing", targetId: row.id, metadata: { name: row.name, reason } });
    return this.detail(row.id);
  }

  /** Retiro de la administración: deja de verse y **desinstala** de todas las organizaciones que la tenían. */
  async withdraw(adminId: string, listingId: string, reason: string): Promise<AdminMarketplaceListingResponse> {
    const row = await this.getListing(listingId);
    if (row.status !== MarketplaceListingStatus.APPROVED && row.status !== MarketplaceListingStatus.IN_REVIEW) {
      throw conflict("INVALID_STATE", "Esta publicación no está activa.");
    }
    await this.withdrawListing(row, adminId, reason);
    await this.audit.record({ organizationId: row.submittedByOrganizationId, actorId: adminId, action: "admin.marketplace_withdrawn", targetType: "MarketplaceListing", targetId: row.id, metadata: { name: row.name, reason } });
    return this.detail(row.id);
  }

  private async withdrawListing(row: MarketplaceListing, actorId: string, reason: string): Promise<MarketplaceListing> {
    const updated = await this.prisma.marketplaceListing.update({
      where: { id: row.id },
      data: { status: MarketplaceListingStatus.WITHDRAWN, reviewReason: reason, reviewedById: actorId, reviewedAt: new Date() },
    });
    const installs = await this.prisma.marketplaceInstall.findMany({ where: { listingId: row.id } });
    for (const install of installs) {
      await this.removeInstall(install, actorId);
      await this.audit.record({ organizationId: install.organizationId, actorId, action: "marketplace.uninstalled", targetType: "MarketplaceListing", targetId: row.id, metadata: { kind: row.kind, name: row.name, reason: "withdrawn" } });
    }
    return updated;
  }
}
