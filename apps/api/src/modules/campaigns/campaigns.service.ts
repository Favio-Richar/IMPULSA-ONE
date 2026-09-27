import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { CampaignAudienceResponse, CampaignResponse, CampaignSegmentOptionsResponse } from "@impulza/contracts";
import type { EmailAdapter } from "@impulza/auth";
import type { Campaign, Prisma, PrismaClient } from "@impulza/database";
import {
  campaignEmail,
  campaignSegmentSchema,
  MAX_CAMPAIGN_RECIPIENTS,
  type CampaignInput,
  type CampaignSegment,
  type UpdateCampaignInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { sanitizeRichText } from "../blocks/sanitize.js";
import { PlansService } from "../plans/plans.service.js";

export const CAMPAIGN_NOT_FOUND = "Campaña no encontrada: no existe, o pertenece a otra organización (ADR-002).";
export const CAMPAIGN_NOT_DRAFT = "Solo se puede cambiar una campaña en borrador.";
export const ANOTHER_SENDING = "Ya hay una campaña enviándose. Espera a que termine o detenla.";
export const NO_AUDIENCE = "Ningún contacto de este segmento aceptó recibir correos.";
export const LINKS_NOT_CONFIGURED = "Esta instalación no tiene configurado el enlace de baja: no se pueden enviar campañas.";

/**
 * Contactos que pueden recibir una campaña: los de la organización, con correo, que aceptaron
 * marketing (casilla aparte, F5.6) y no se dieron de baja, más el segmento. Única regla — la usan
 * la vista previa de audiencia, el alta del envío y (repetida en el worker, al momento de enviar
 * cada correo) la comprobación de baja de último momento.
 */
export function eligibleContactsWhere(organizationId: string, segment: CampaignSegment): Prisma.ContactWhereInput {
  return {
    organizationId,
    email: { not: null },
    marketingConsentAt: { not: null },
    marketingUnsubscribedAt: null,
    ...(segment.tags.length > 0 ? { tags: { hasSome: segment.tags } } : {}),
    ...(segment.sources.length > 0 ? { source: { in: segment.sources } } : {}),
    ...(segment.commercialStatuses.length > 0 ? { commercialStatus: { in: segment.commercialStatuses } } : {}),
  };
}

/**
 * Campañas de email (F5.6). Todo con alcance `organizationId` (404 ante un id cruzado, ADR-002);
 * escribir y enviar exige `campaign.manage`. El envío congela la lista de destinatarios y el worker
 * la despacha al ritmo del plan; la API nunca envía la campaña real (solo la prueba al propio autor).
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly auditService: AuditService,
    private readonly plansService: PlansService,
  ) {}

  private segmentOf(campaign: Campaign): CampaignSegment {
    const parsed = campaignSegmentSchema.safeParse(campaign.segment);
    if (!parsed.success) {
      logger.error("segmento de campaña inválido en la base", { campaignId: campaign.id });
      throw new InternalServerErrorException("Campaña inválida.");
    }
    return parsed.data;
  }

  private async toResponse(campaign: Campaign): Promise<CampaignResponse> {
    const [grouped, unsubscribed] = await Promise.all([
      this.prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: { _all: true } }),
      this.prisma.campaignRecipient.count({ where: { campaignId: campaign.id, unsubscribedAt: { not: null } } }),
    ]);
    const stats = { pending: 0, sent: 0, failed: 0, skipped: 0, unsubscribed };
    for (const row of grouped) {
      stats[row.status.toLowerCase() as "pending" | "sent" | "failed" | "skipped"] = row._count._all;
    }
    return {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      bodyHtml: campaign.bodyHtml,
      segment: this.segmentOf(campaign),
      status: campaign.status,
      recipientCount: campaign.recipientCount,
      emailsPerHour: campaign.emailsPerHour,
      stats,
      sendStartedAt: campaign.sendStartedAt?.toISOString() ?? null,
      sentAt: campaign.sentAt?.toISOString() ?? null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }

  private async getOrThrow(organizationId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign) {
      throw new NotFoundException(CAMPAIGN_NOT_FOUND);
    }
    return campaign;
  }

  async list(organizationId: string): Promise<CampaignResponse[]> {
    const campaigns = await this.prisma.campaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    return Promise.all(campaigns.map((campaign) => this.toResponse(campaign)));
  }

  async get(organizationId: string, campaignId: string): Promise<CampaignResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, campaignId));
  }

  async create(organizationId: string, actorId: string, input: CampaignInput): Promise<CampaignResponse> {
    const created = await this.prisma.campaign.create({
      data: {
        organizationId,
        createdById: actorId,
        name: input.name,
        subject: input.subject,
        bodyHtml: sanitizeRichText(input.bodyHtml),
        segment: input.segment as Prisma.InputJsonValue,
      },
    });
    await this.auditService.record({ organizationId, actorId, action: "campaign.created", targetType: "Campaign", targetId: created.id, metadata: { name: created.name } });
    return this.toResponse(created);
  }

  async update(organizationId: string, actorId: string, campaignId: string, changes: UpdateCampaignInput): Promise<CampaignResponse> {
    const current = await this.getOrThrow(organizationId, campaignId);
    // Condicional al estado: si otra persona la envió recién, este cambio no la pisa.
    const result = await this.prisma.campaign.updateMany({
      where: { id: current.id, organizationId, status: "DRAFT" },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.subject === undefined ? {} : { subject: changes.subject }),
        ...(changes.bodyHtml === undefined ? {} : { bodyHtml: sanitizeRichText(changes.bodyHtml) }),
        ...(changes.segment === undefined ? {} : { segment: changes.segment as Prisma.InputJsonValue }),
      },
    });
    if (result.count === 0) {
      throw new ConflictException(CAMPAIGN_NOT_DRAFT);
    }
    await this.auditService.record({ organizationId, actorId, action: "campaign.updated", targetType: "Campaign", targetId: current.id, metadata: { fields: Object.keys(changes) } });
    return this.get(organizationId, current.id);
  }

  async remove(organizationId: string, actorId: string, campaignId: string): Promise<void> {
    const current = await this.getOrThrow(organizationId, campaignId);
    const result = await this.prisma.campaign.deleteMany({ where: { id: current.id, organizationId, status: "DRAFT" } });
    if (result.count === 0) {
      throw new ConflictException("Solo se puede borrar una campaña en borrador: las enviadas quedan como registro.");
    }
    await this.auditService.record({ organizationId, actorId, action: "campaign.deleted", targetType: "Campaign", targetId: current.id, metadata: { name: current.name } });
  }

  async audience(organizationId: string, segment: CampaignSegment): Promise<CampaignAudienceResponse> {
    const [eligible, withMarketingConsent, totalContacts] = await Promise.all([
      this.prisma.contact.count({ where: eligibleContactsWhere(organizationId, segment) }),
      this.prisma.contact.count({ where: eligibleContactsWhere(organizationId, { tags: [], sources: [], commercialStatuses: [] }) }),
      this.prisma.contact.count({ where: { organizationId } }),
    ]);
    return { eligible, withMarketingConsent, totalContacts };
  }

  async segmentOptions(organizationId: string): Promise<CampaignSegmentOptionsResponse> {
    const [tags, sources] = await Promise.all([
      this.prisma.$queryRaw<Array<{ tag: string }>>`SELECT DISTINCT unnest(tags) AS tag FROM contacts WHERE organization_id = ${organizationId}::uuid ORDER BY 1 LIMIT 200`,
      this.prisma.contact.findMany({
        where: { organizationId, source: { not: null } },
        distinct: ["source"],
        select: { source: true },
        orderBy: { source: "asc" },
        take: 200,
      }),
    ]);
    return { tags: tags.map((row) => row.tag), sources: sources.map((row) => row.source!).filter(Boolean) };
  }

  /** Envío de prueba al propio autor (marcado "[Prueba]" en el asunto), sin tocar la campaña. */
  async sendTest(organizationId: string, actor: { id: string; email: string }, campaignId: string): Promise<void> {
    const campaign = await this.getOrThrow(organizationId, campaignId);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const content = campaignEmail({ organizationName: organization.name, subject: campaign.subject, bodyHtml: campaign.bodyHtml, unsubscribeUrl: null, test: true });
    try {
      await this.email.send({ to: actor.email, subject: content.subject, text: content.text, html: content.html });
    } catch (error) {
      logger.error("no se pudo enviar la prueba de una campaña", { campaignId, error: error instanceof Error ? error.message : String(error) });
      throw new ServiceUnavailableException("No pudimos enviar la prueba. Intenta de nuevo en un momento.");
    }
    await this.auditService.record({ organizationId, actorId: actor.id, action: "campaign.test_sent", targetType: "Campaign", targetId: campaign.id, metadata: {} });
  }

  /**
   * Inicia el envío: congela los destinatarios que cumplen el segmento **ahora** y deja la campaña
   * en `SENDING` con el límite por hora del plan vigente; el worker la despacha. Una organización
   * envía una campaña a la vez.
   */
  async send(organizationId: string, actorId: string, campaignId: string): Promise<CampaignResponse> {
    if (!env.PUBLIC_SITE_BASE_URL || !env.BOOKING_LINK_SECRET) {
      throw new ServiceUnavailableException(LINKS_NOT_CONFIGURED);
    }
    const campaign = await this.getOrThrow(organizationId, campaignId);
    if (campaign.status !== "DRAFT") {
      throw new ConflictException(CAMPAIGN_NOT_DRAFT);
    }
    const segment = this.segmentOf(campaign);
    const { plan } = await this.plansService.resolveEffectivePlan(organizationId);

    const recipientCount = await this.prisma.$transaction(async (tx) => {
      // Un envío a la vez por organización: dos "Enviar" simultáneos no se intercalan.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-send:${organizationId}`}::text, 0))`;
      const sending = await tx.campaign.count({ where: { organizationId, status: "SENDING" } });
      if (sending > 0) {
        throw new ConflictException(ANOTHER_SENDING);
      }
      const contacts = await tx.contact.findMany({
        where: eligibleContactsWhere(organizationId, segment),
        select: { id: true, email: true },
        orderBy: { createdAt: "asc" },
        take: MAX_CAMPAIGN_RECIPIENTS + 1,
      });
      if (contacts.length === 0) {
        throw new UnprocessableEntityException(NO_AUDIENCE);
      }
      if (contacts.length > MAX_CAMPAIGN_RECIPIENTS) {
        throw new UnprocessableEntityException(`Una campaña admite hasta ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString("es-CL")} destinatarios: acota el segmento.`);
      }
      const claimed = await tx.campaign.updateMany({
        where: { id: campaign.id, organizationId, status: "DRAFT" },
        data: { status: "SENDING", sendStartedAt: new Date(), recipientCount: contacts.length, emailsPerHour: plan.limits.emailsPerHour },
      });
      if (claimed.count === 0) {
        throw new ConflictException(CAMPAIGN_NOT_DRAFT);
      }
      await tx.campaignRecipient.createMany({
        data: contacts.map((contact) => ({ campaignId: campaign.id, organizationId, contactId: contact.id, email: contact.email! })),
      });
      return contacts.length;
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "campaign.send_started",
      targetType: "Campaign",
      targetId: campaign.id,
      metadata: { recipients: recipientCount, emailsPerHour: plan.limits.emailsPerHour },
    });
    logger.info("campaña en envío", { organizationId, campaignId: campaign.id, recipients: recipientCount });
    return this.get(organizationId, campaign.id);
  }

  /** Detiene un envío en curso: lo que no salió queda sin enviar. */
  async cancel(organizationId: string, actorId: string, campaignId: string): Promise<CampaignResponse> {
    const current = await this.getOrThrow(organizationId, campaignId);
    const stopped = await this.prisma.$transaction(async (tx) => {
      const result = await tx.campaign.updateMany({ where: { id: current.id, organizationId, status: "SENDING" }, data: { status: "CANCELLED" } });
      if (result.count === 0) {
        return false;
      }
      await tx.campaignRecipient.updateMany({ where: { campaignId: current.id, status: "PENDING" }, data: { status: "SKIPPED", error: "Envío detenido." } });
      return true;
    });
    if (!stopped) {
      throw new ConflictException("Solo se puede detener una campaña que se está enviando.");
    }
    await this.auditService.record({ organizationId, actorId, action: "campaign.cancelled", targetType: "Campaign", targetId: current.id, metadata: {} });
    return this.get(organizationId, current.id);
  }
}

