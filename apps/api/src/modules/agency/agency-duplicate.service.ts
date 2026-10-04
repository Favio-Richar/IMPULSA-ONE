import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { agencyDuplicateReport, type AgencyDuplicateReport, type AgencyDuplicateResponse } from "@impulza/contracts";
import { AgencyClientStatus, OrganizationKind, Prisma, SiteStatus, type PrismaClient, type User } from "@impulza/database";
import {
  DUPLICATE_NOT_COPIED,
  prepareBackground,
  prepareBlockForDuplicate,
  prepareSeoMeta,
  remapSmartCta,
  reviewHintsFor,
  type BlockSkipReason,
  type DuplicateClientDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";
import { relationGrantsAccess } from "./agency-access.service.js";
import { AgencyService } from "./agency.service.js";

type Tx = Prisma.TransactionClient;
const SLUG_ATTEMPTS = 6;

/**
 * Duplicar un cliente (F9.5c, ADR-028 §2): crea una organización NUEVA —igual que «Nuevo cliente», con la invitación a su
 * propietario— y copia el contenido del sitio en la misma transacción: o queda todo o no queda nada. Todo llega en **borrador**.
 *
 * Qué viaja: sitios, páginas, bloques, temas propios y colores de marca. Qué nunca viaja (ver `DUPLICATE_NOT_COPIED`): contactos,
 * respuestas, pedidos, reservas, pagos, cuentas de cobro, claves, medios de la biblioteca, dominios, identificadores de medición,
 * productos, servicios y formularios. Una copia jamás queda apuntando a un archivo o recurso del cliente origen: sería una referencia
 * cruzada entre organizaciones (ADR-002) y filtraría datos del negocio origen.
 */
@Injectable()
export class AgencyDuplicateService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly agency: AgencyService,
  ) {}

  async duplicate(agencyOrganizationId: string, actor: User, sourceRelationId: string, dto: DuplicateClientDto): Promise<AgencyDuplicateResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const source = await this.prisma.agencyClient.findFirst({
      where: { id: sourceRelationId, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      include: { clientOrganization: { select: { id: true, kind: true } } },
    });
    if (!source) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    if (!relationGrantsAccess(source) || source.clientOrganization.kind !== OrganizationKind.BUSINESS) {
      throw new ConflictException("Este cliente no tiene una relación con acceso: no se puede duplicar.");
    }

    const payloadHash = createHash("sha256")
      .update(JSON.stringify([source.id, dto.name, dto.slug, dto.ownerEmail, dto.billingMode]))
      .digest("hex");

    const replay = await this.replayOf(agencyOrganizationId, dto.idempotencyKey, payloadHash);
    if (replay) return replay;

    let report: AgencyDuplicateReport | null = null;
    try {
      const client = await this.agency.createClientWith(
        agencyOrganizationId,
        actor,
        { name: dto.name, slug: dto.slug, ownerEmail: dto.ownerEmail, billingMode: dto.billingMode },
        async (tx, relation) => {
          report = await this.copyContent(tx, source.clientOrganizationId, relation.clientOrganizationId, dto.slug);
          await tx.agencyDuplication.create({
            data: { agencyOrganizationId, idempotencyKey: dto.idempotencyKey, payloadHash, sourceAgencyClientId: source.id, targetAgencyClientId: relation.id, report },
          });
        },
      );
      const done = report as AgencyDuplicateReport | null;
      if (!done) throw new Error("La duplicación terminó sin informe.");

      await this.audit.record({
        organizationId: agencyOrganizationId,
        actorId: actor.id,
        action: "agency.client.duplicated",
        targetType: "AgencyClient",
        targetId: client.id,
        metadata: { sourceClientOrganizationId: source.clientOrganizationId, targetClientOrganizationId: client.clientOrganizationId, sites: done.sites, pages: done.pages, blocks: done.blocks },
      });
      // El propietario del negocio origen ve en su historial que su agencia copió su sitio (sin saber a quién ni a dónde).
      await this.audit.record({
        organizationId: source.clientOrganizationId,
        actorId: actor.id,
        action: "agency.client.duplicated_from",
        targetType: "AgencyClient",
        targetId: source.id,
        metadata: { agencyOrganizationId, sites: done.sites, pages: done.pages, blocks: done.blocks },
      });
      return { client, replayed: false, report: done };
    } catch (error) {
      // Dos peticiones con la misma clave a la vez: una gana y la otra recibe su resultado. Se distingue de un identificador repetido
      // mirando si la clave quedó registrada.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.replayOf(agencyOrganizationId, dto.idempotencyKey, payloadHash);
        if (winner) return winner;
        throw new ConflictException("Ese identificador ya está en uso.");
      }
      throw error;
    }
  }

  /** Si la clave ya se usó con esta misma petición, devuelve lo que pasó la primera vez; con otra petición, 409. */
  private async replayOf(agencyOrganizationId: string, idempotencyKey: string, payloadHash: string): Promise<AgencyDuplicateResponse | null> {
    const existing = await this.prisma.agencyDuplication.findUnique({ where: { agencyOrganizationId_idempotencyKey: { agencyOrganizationId, idempotencyKey } } });
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException("Esa clave de idempotencia ya se usó con otra petición. Usa una clave nueva para duplicar otra vez.");
    }
    const report = agencyDuplicateReport.safeParse(existing.report);
    if (!report.success) {
      logger.error("agency: informe de duplicación inválido en la base", { duplicationId: existing.id });
      throw new ConflictException("No se pudo recuperar el resultado de la duplicación anterior.");
    }
    return { client: await this.agency.clientResponse(agencyOrganizationId, existing.targetAgencyClientId), replayed: true, report: report.data };
  }

  /** Copia el contenido del origen a la organización nueva, dentro de la transacción del alta. Todo queda en borrador. */
  private async copyContent(tx: Tx, sourceOrganizationId: string, targetOrganizationId: string, targetSlug: string): Promise<AgencyDuplicateReport> {
    const { plan } = await this.plans.resolveEffectivePlan(targetOrganizationId, tx);
    const maxSites = plan.limits.sites;
    const maxPages = plan.limits.pagesPerSite;

    const [sites, sourceThemes, sourceBrand] = await Promise.all([
      tx.site.findMany({
        where: { organizationId: sourceOrganizationId, status: { not: SiteStatus.ARCHIVED } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          pages: {
            where: { deletedAt: null },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: { blocks: { orderBy: { position: "asc" }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } } },
          },
        },
      }),
      tx.theme.findMany({ where: { organizationId: sourceOrganizationId } }),
      tx.brandProfile.findUnique({ where: { organizationId: sourceOrganizationId } }),
    ]);

    const report: AgencyDuplicateReport = {
      sites: 0,
      pages: 0,
      blocks: 0,
      themes: 0,
      brandColorsCopied: false,
      imagesRemoved: 0,
      referencesCleared: 0,
      smartCtaRulesDropped: 0,
      skippedByPlan: { sites: 0, pages: 0 },
      blocksSkipped: [],
      needsReview: [],
      notCopied: [...DUPLICATE_NOT_COPIED],
    };
    const copiedTypes: string[] = [];
    const themeMap = new Map<string, string | null>();

    for (const [index, site] of sites.entries()) {
      if (maxSites !== null && report.sites >= maxSites) {
        report.skippedByPlan.sites += 1;
        continue;
      }

      // Temas: los propios del origen se copian una vez; los del catálogo son de todos y se comparten.
      let themeId: string | null = null;
      if (site.themeId) {
        if (!themeMap.has(site.themeId)) {
          const own = sourceThemes.find((theme) => theme.id === site.themeId);
          if (own) {
            const created = await tx.theme.create({ data: { organizationId: targetOrganizationId, name: own.name, tokens: own.tokens as Prisma.InputJsonValue } });
            themeMap.set(site.themeId, created.id);
            report.themes += 1;
          } else {
            // Un tema del catálogo (sin organización) se comparte; cualquier otro caso no se arrastra.
            const shared = await tx.theme.findFirst({ where: { id: site.themeId, organizationId: null }, select: { id: true } });
            themeMap.set(site.themeId, shared?.id ?? null);
          }
        }
        themeId = themeMap.get(site.themeId) ?? null;
      }

      const background = prepareBackground(site.background, sourceOrganizationId);
      report.imagesRemoved += background.imagesRemoved;
      const newSite = await tx.site.create({
        data: {
          organizationId: targetOrganizationId,
          name: site.name,
          slug: await this.freeSiteSlug(tx, targetSlug, index),
          status: SiteStatus.DRAFT,
          themeId,
          background: background.value === null ? Prisma.DbNull : (background.value as Prisma.InputJsonValue),
          // Los identificadores de medición (GA4, Pixel) son del cliente origen: copiarlos mandaría las visitas del cliente nuevo a su cuenta.
          ga4MeasurementId: null,
          metaPixelId: null,
        },
      });
      report.sites += 1;

      // La página de inicio siempre viaja; el resto, hasta el límite de páginas del plan del cliente nuevo.
      const ordered = [...site.pages].sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.position - b.position);
      const pages = maxPages === null ? ordered : ordered.slice(0, Math.max(maxPages, 1));
      report.skippedByPlan.pages += ordered.length - pages.length;

      const pageRows: Prisma.PageCreateManyInput[] = [];
      const blockRows: Prisma.BlockCreateManyInput[] = [];
      const versionRows: Prisma.BlockVersionCreateManyInput[] = [];

      for (const page of pages) {
        const pageId = randomUUID();
        const blockIdMap = new Map<string, string>();
        for (const block of page.blocks) {
          const version = block.versions[0];
          const prepared = version
            ? prepareBlockForDuplicate({ type: block.type, schemaVersion: block.configSchemaVersion, config: version.config, sourceOrganizationId })
            : ({ outcome: "skipped", reason: "invalid_after_cleanup" } as const);
          if (prepared.outcome === "skipped") {
            report.blocksSkipped.push({ type: block.type, reason: prepared.reason satisfies BlockSkipReason });
            continue;
          }
          const blockId = randomUUID();
          blockIdMap.set(block.id, blockId);
          blockRows.push({
            id: blockId,
            pageId,
            type: block.type,
            position: block.position,
            configSchemaVersion: block.configSchemaVersion,
            visible: block.visible,
            scheduledStart: block.scheduledStart,
            scheduledEnd: block.scheduledEnd,
            isPrimary: block.isPrimary,
          });
          versionRows.push({ blockId, versionNumber: 1, config: prepared.config as Prisma.InputJsonValue });
          report.imagesRemoved += prepared.imagesRemoved;
          report.referencesCleared += prepared.referencesCleared;
          report.blocks += 1;
          copiedTypes.push(block.type);
        }

        const seo = prepareSeoMeta(page.seoMeta, sourceOrganizationId);
        report.imagesRemoved += seo.imagesRemoved;
        const smartCta = remapSmartCta(page.smartCta, blockIdMap);
        report.smartCtaRulesDropped += smartCta.dropped;
        pageRows.push({
          id: pageId,
          siteId: newSite.id,
          slug: page.slug,
          position: page.position,
          visibility: page.visibility,
          status: "DRAFT",
          isHome: page.isHome,
          seoMeta: seo.value === null ? Prisma.DbNull : (seo.value as Prisma.InputJsonValue),
          smartCta: smartCta.value === null ? Prisma.DbNull : (smartCta.value as Prisma.InputJsonValue),
        });
        report.pages += 1;
      }

      await tx.page.createMany({ data: pageRows });
      if (blockRows.length > 0) {
        await tx.block.createMany({ data: blockRows });
        await tx.blockVersion.createMany({ data: versionRows });
      }
    }

    // Marca: solo los colores. El logo es un archivo del origen y la razón social y los datos fiscales no se copian.
    if (sourceBrand && (sourceBrand.primaryColor || sourceBrand.secondaryColor)) {
      const colors = { primaryColor: sourceBrand.primaryColor, secondaryColor: sourceBrand.secondaryColor };
      await tx.brandProfile.upsert({ where: { organizationId: targetOrganizationId }, create: { organizationId: targetOrganizationId, ...colors }, update: colors });
      report.brandColorsCopied = true;
    }
    if (sourceBrand && (sourceBrand.logoLightUrl || sourceBrand.logoDarkUrl || sourceBrand.faviconUrl)) report.imagesRemoved += 1;

    report.needsReview = reviewHintsFor(copiedTypes);
    return report;
  }

  /** Un identificador de sitio libre: el del cliente nuevo para el primero, `-2`, `-3`… para los siguientes, y un sufijo si ya está tomado. */
  private async freeSiteSlug(tx: Tx, base: string, index: number): Promise<string> {
    const first = index === 0 ? base : `${base}-${index + 1}`;
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 0 ? first : `${first}-${randomUUID().slice(0, 4)}`;
      const [site, redirect] = await Promise.all([tx.site.findUnique({ where: { slug: candidate }, select: { id: true } }), tx.siteSlugRedirect.findUnique({ where: { fromSlug: candidate }, select: { id: true } })]);
      if (!site && !redirect) return candidate;
    }
    throw new ConflictException("No pudimos asignar un identificador libre a un sitio de la copia: elige otro identificador para el cliente.");
  }
}
