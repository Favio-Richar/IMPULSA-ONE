import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, GoneException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { NewsletterStatsResponse, PublicNewsletterConfirmationResponse, PublicNewsletterSignupResponse } from "@impulza/contracts";
import { ContactEventType, Prisma, type PrismaClient } from "@impulza/database";
import {
  NEWSLETTER_CONFIRMATION_TTL_HOURS,
  NEWSLETTER_CONSENT_TEXT_VERSION,
  NEWSLETTER_HONEYPOT_FIELD,
  NEWSLETTER_MAX_EMAILS_PER_DAY,
  NEWSLETTER_TAG,
  newsletterAlreadySubscribedEmail,
  newsletterConfirmationEmail,
  newsletterConsentSource,
  newsletterSignupSchema,
} from "@impulza/validation";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { AutomationEventsService } from "../automations/automation-events.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { maskEmail } from "../campaigns/public-unsubscribe.service.js";
import { ContactsService } from "../contacts/contacts.service.js";

export const NEWSLETTER_NOT_FOUND = "Este sitio no tiene newsletter.";
export const CONFIRMATION_NOT_FOUND = "Enlace no válido.";
export const CONFIRMATION_EXPIRED = "NEWSLETTER_CONFIRMATION_EXPIRED";

const PENDING: PublicNewsletterSignupResponse = { status: "pending" };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Newsletter con doble confirmación (F7.4, ADR-019). La solicitud deja una confirmación pendiente
 * (sin crear contacto) y envía el enlace; confirmar —con un clic, no al abrir— crea o actualiza el
 * contacto con su consentimiento de marketing. La respuesta pública es siempre la misma.
 */
@Injectable()
export class NewsletterService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly automationEvents: AutomationEventsService,
  ) {}

  async request(siteSlug: string, raw: unknown, now = new Date()): Promise<PublicNewsletterSignupResponse> {
    const parsed = newsletterSignupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Entrada inválida.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION },
      select: { id: true, name: true, organizationId: true },
    });
    // Solo sitios que ofrecen la newsletter en una página publicada: el formulario no sirve para
    // mandar correos desde cualquier sitio.
    const offered = site
      ? await this.prisma.block.count({ where: { type: "newsletter", visible: true, page: { siteId: site.id, status: "PUBLISHED" } } })
      : 0;
    if (!site || offered === 0) {
      throw new NotFoundException(NEWSLETTER_NOT_FOUND);
    }

    // Honeypot: éxito aparente, nada guardado ni enviado (avisarle solo le enseña a evadirlo).
    const trap = parsed.data[NEWSLETTER_HONEYPOT_FIELD];
    if (typeof trap === "string" && trap.trim().length > 0) {
      logger.info("newsletter: honeypot", { siteId: site.id });
      return PENDING;
    }

    const { email, name } = parsed.data;
    const recent = await this.prisma.newsletterConfirmation.count({
      where: { siteId: site.id, email, createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
    });
    if (recent >= NEWSLETTER_MAX_EMAILS_PER_DAY) {
      logger.warn("newsletter: tope diario por dirección", { siteId: site.id });
      return PENDING;
    }

    const existing = await this.prisma.contact.findFirst({
      where: { organizationId: site.organizationId, email, marketingConsentAt: { not: null }, marketingUnsubscribedAt: null },
      select: { id: true },
    });
    if (existing) {
      // Ya suscrito: un aviso sin enlace. Se registra igual (cuenta para el tope diario).
      await this.prisma.newsletterConfirmation.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          email,
          name: name ?? null,
          tokenHash: hashToken(randomBytes(32).toString("base64url")),
          consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
          expiresAt: now,
          createdAt: new Date(now.getTime() - 1),
          confirmedAt: now,
          contactId: existing.id,
        },
      });
      await this.send(email, newsletterAlreadySubscribedEmail({ siteName: site.name }));
      return PENDING;
    }

    if (!env.PUBLIC_SITE_BASE_URL) {
      logger.error("newsletter: PUBLIC_SITE_BASE_URL no configurada", { siteId: site.id });
      throw new ServiceUnavailableException("La suscripción no está disponible en este momento.");
    }
    const token = randomBytes(32).toString("base64url");
    await this.prisma.newsletterConfirmation.create({
      data: {
        organizationId: site.organizationId,
        siteId: site.id,
        email,
        name: name ?? null,
        tokenHash: hashToken(token),
        consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
        expiresAt: new Date(now.getTime() + NEWSLETTER_CONFIRMATION_TTL_HOURS * 3_600_000),
        createdAt: now,
      },
    });
    const confirmUrl = `${env.PUBLIC_SITE_BASE_URL.replace(/\/+$/, "")}/suscripcion/${token}`;
    await this.send(email, newsletterConfirmationEmail({ siteName: site.name, confirmUrl, name }));
    logger.info("newsletter: confirmación enviada", { organizationId: site.organizationId, siteId: site.id });
    return PENDING;
  }

  async view(token: string, now = new Date()): Promise<PublicNewsletterConfirmationResponse> {
    const row = await this.rowOrThrow(token);
    return this.toView(row, now);
  }

  /**
   * Confirma con un clic. Se reclama con una actualización condicional (sin confirmar y vigente):
   * dos clics a la vez confirman una sola vez. Vencido: 410 con su código.
   */
  async confirm(token: string, now = new Date()): Promise<PublicNewsletterConfirmationResponse> {
    const row = await this.rowOrThrow(token);
    if (row.confirmedAt) return this.toView(row, now);
    if (row.expiresAt <= now) {
      throw new GoneException({ statusCode: 410, error: "Gone", code: CONFIRMATION_EXPIRED, message: "Este enlace venció. Vuelve a suscribirte desde la página." });
    }
    const claimed = await this.prisma.newsletterConfirmation.updateMany({
      where: { id: row.id, confirmedAt: null, expiresAt: { gt: now } },
      data: { confirmedAt: now },
    });
    if (claimed.count === 0) {
      return this.toView(await this.rowOrThrow(token), now);
    }

    const { contact } = await this.contacts.findOrCreateFromSubmission({
      organizationId: row.organizationId,
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      consentSource: `newsletter:${row.siteId}`,
      consentTextVersion: row.consentTextVersion,
    });
    await this.contacts.recordMarketingConsent(contact.id, newsletterConsentSource(row.siteId), row.consentTextVersion);
    await this.prisma.$transaction([
      this.prisma.$executeRaw`UPDATE contacts SET tags = array_append(tags, ${NEWSLETTER_TAG}), updated_at = now() WHERE id = ${contact.id}::uuid AND NOT (${NEWSLETTER_TAG} = ANY(tags))`,
      this.prisma.contactEvent.create({ data: { contactId: contact.id, type: ContactEventType.NEWSLETTER, payload: { siteId: row.siteId } as Prisma.InputJsonValue } }),
      this.prisma.newsletterConfirmation.update({ where: { id: row.id }, data: { contactId: contact.id } }),
    ]);
    await this.audit.record({
      organizationId: row.organizationId,
      actorId: null,
      action: "contact.newsletter_subscribed",
      targetType: "Contact",
      targetId: contact.id,
      metadata: { siteId: row.siteId, consentTextVersion: row.consentTextVersion },
    });
    // Automatizaciones y secuencias de bienvenida (F7.5). El id de la confirmación es el del evento.
    await this.automationEvents.emit({ organizationId: row.organizationId, trigger: "newsletter_subscribed", subjectId: row.id, contactId: contact.id });
    logger.info("newsletter: suscripción confirmada", { organizationId: row.organizationId, siteId: row.siteId, contactId: contact.id });
    return this.toView({ ...row, confirmedAt: now }, now);
  }

  async stats(organizationId: string, now = new Date()): Promise<NewsletterStatsResponse> {
    const audience = { organizationId, email: { not: null }, marketingConsentAt: { not: null }, marketingUnsubscribedAt: null } as const;
    const [marketingAudience, confirmedSubscribers, pendingConfirmations, confirmedLast30Days] = await Promise.all([
      this.prisma.contact.count({ where: audience }),
      this.prisma.contact.count({ where: { ...audience, marketingConsentSource: { startsWith: "newsletter:" } } }),
      this.prisma.newsletterConfirmation.count({ where: { organizationId, confirmedAt: null, expiresAt: { gt: now } } }),
      this.prisma.contactEvent.count({
        where: { type: ContactEventType.NEWSLETTER, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3_600_000) }, contact: { organizationId } },
      }),
    ]);
    return { marketingAudience, confirmedSubscribers, pendingConfirmations, confirmedLast30Days };
  }

  private async rowOrThrow(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException(CONFIRMATION_NOT_FOUND);
    const row = await this.prisma.newsletterConfirmation.findFirst({
      where: { tokenHash: hashToken(token), organization: { status: "ACTIVE" } },
      include: { site: { select: { name: true } }, organization: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException(CONFIRMATION_NOT_FOUND);
    return row;
  }

  private toView(
    row: { confirmedAt: Date | null; expiresAt: Date; email: string; site: { name: string }; organization: { name: string } },
    now: Date,
  ): PublicNewsletterConfirmationResponse {
    return {
      organizationName: row.organization.name,
      siteName: row.site.name,
      maskedEmail: maskEmail(row.email),
      state: row.confirmedAt ? "confirmed" : row.expiresAt <= now ? "expired" : "pending",
    };
  }

  /** El correo nunca hace fallar la respuesta (sería una pista de qué direcciones existen). */
  private async send(to: string, content: { subject: string; text: string }): Promise<void> {
    try {
      await this.email.send({ to, subject: content.subject, text: content.text });
    } catch (error) {
      logger.error("newsletter: no se pudo enviar el correo", { err: error });
    }
  }
}
