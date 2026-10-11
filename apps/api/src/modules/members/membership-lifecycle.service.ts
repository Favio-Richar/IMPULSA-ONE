import { Inject, Injectable } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import { MembershipPurchaseStatus, SiteMemberSource, SiteMemberStatus, type PrismaClient } from "@impulza/database";
import {
  MEMBERSHIP_EXPIRY_NOTICE_WINDOW_DAYS,
  MEMBERSHIP_RENEWAL_REMINDER_DAYS,
  membershipNoticeDue,
  type PurchaseForAccess,
} from "@impulza/validation";
import { SERVED_SITE } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";

const BATCH = 500;
const DAY = 86_400_000;
const PERIOD_FIELDS = { status: true, paymentStatus: true, amount: true, refundedAmount: true, periodEnd: true } as const;
const dateText = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" });

/**
 * Avisos del ciclo de una membresía (F10.2b, ADR-029): un recordatorio de renovación en la última semana y un aviso de vencimiento
 * poco después de terminar. Cada aviso se manda UNA vez por compra: la marca se reclama de forma condicional antes de enviar, así que
 * dos réplicas o dos pasadas no duplican nada. Solo avisa del último periodo del miembro (si ya renovó, no hay nada que avisar) y
 * nunca a un miembro revocado, ni de un pago reembolsado, ni de un sitio que no se sirve. Un fallo al enviar se registra y no repite.
 */
@Injectable()
export class MembershipLifecycleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(BrandProfileService) private readonly brandProfile: BrandProfileService,
  ) {}

  async runDue(now: Date = new Date()): Promise<{ reminders: number; expiries: number }> {
    // Sin URL pública no se puede armar el enlace de renovación: no se reclama nada, para que un aviso no se pierda.
    if (!env.PUBLIC_SITE_BASE_URL) return { reminders: 0, expiries: 0 };

    const candidates = await this.prisma.membershipPurchase.findMany({
      where: {
        status: MembershipPurchaseStatus.PAID,
        paymentStatus: "approved",
        member: { status: SiteMemberStatus.ACTIVE, source: SiteMemberSource.PURCHASED, site: SERVED_SITE },
        OR: [
          { renewalReminderSentAt: null, periodEnd: { gt: now, lte: new Date(now.getTime() + MEMBERSHIP_RENEWAL_REMINDER_DAYS * DAY) } },
          { expiryNoticeSentAt: null, periodEnd: { lte: now, gt: new Date(now.getTime() - MEMBERSHIP_EXPIRY_NOTICE_WINDOW_DAYS * DAY) } },
        ],
      },
      orderBy: { periodEnd: "asc" },
      take: BATCH,
      include: {
        member: { select: { id: true, email: true, site: { select: { slug: true, name: true } } } },
      },
    });
    if (candidates.length === 0) return { reminders: 0, expiries: 0 };

    // Todas las compras pagadas de esos miembros, para saber si ya renovaron.
    const memberIds = [...new Set(candidates.map((purchase) => purchase.memberId))];
    const all = await this.prisma.membershipPurchase.findMany({
      where: { memberId: { in: memberIds }, status: MembershipPurchaseStatus.PAID },
      select: { memberId: true, ...PERIOD_FIELDS },
    });
    const byMember = new Map<string, PurchaseForAccess[]>();
    for (const purchase of all) {
      const list = byMember.get(purchase.memberId) ?? [];
      list.push(purchase);
      byMember.set(purchase.memberId, list);
    }

    let reminders = 0;
    let expiries = 0;
    for (const purchase of candidates) {
      const due = membershipNoticeDue(purchase, byMember.get(purchase.memberId) ?? [], now);
      if (!due) continue;

      // Reclamar antes de enviar: gana una sola pasada o réplica.
      const claimed = await this.prisma.membershipPurchase.updateMany({
        where: due === "renewal_reminder" ? { id: purchase.id, renewalReminderSentAt: null } : { id: purchase.id, expiryNoticeSentAt: null },
        data: due === "renewal_reminder" ? { renewalReminderSentAt: now } : { expiryNoticeSentAt: now },
      });
      if (claimed.count === 0) continue;

      try {
        await this.send(purchase.organizationId, purchase.member.email, purchase.member.site, purchase.planName, purchase.periodEnd as Date, due);
        if (due === "renewal_reminder") reminders += 1;
        else expiries += 1;
      } catch (error) {
        logger.error("membresías: no se pudo enviar el aviso", { purchaseId: purchase.id, kind: due, error });
      }
    }
    if (reminders + expiries > 0) logger.info("membresías: avisos enviados", { reminders, expiries });
    return { reminders, expiries };
  }

  private async send(
    organizationId: string,
    to: string,
    site: { slug: string; name: string },
    planName: string,
    periodEnd: Date,
    kind: "renewal_reminder" | "expiry_notice",
  ): Promise<void> {
    const url = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/${encodeURIComponent(site.slug)}`;
    const date = dateText.format(periodEnd);
    const lines =
      kind === "renewal_reminder"
        ? [
            "Hola:",
            "",
            `Tu membresía «${planName}» en ${site.name} vence el ${date}.`,
            "",
            `Si quieres seguir, renueva desde el sitio: ${url}`,
            "Los días se suman: no pierdes ninguno por renovar antes. Si no haces nada, tu acceso termina en esa fecha y no se te cobra nada.",
          ]
        : [
            "Hola:",
            "",
            `Tu membresía «${planName}» en ${site.name} terminó el ${date}, así que ya no puedes ver el contenido para miembros.`,
            "",
            `Cuando quieras volver, renueva desde el sitio: ${url}`,
            "No se te cobró nada automáticamente.",
          ];
    const subject = kind === "renewal_reminder" ? `Tu membresía en ${site.name} vence pronto` : `Tu membresía en ${site.name} terminó`;
    await this.email.send(await this.brandProfile.brandEmail(organizationId, { to, subject, text: lines.join("\n") }));
  }
}
