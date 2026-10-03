import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { generateVerificationToken, hashToken, type EmailAdapter } from "@impulza/auth";
import type {
  AcceptOwnerInvitationResponse,
  AgencyClientResponse,
  AgencyLinkResponse,
  AgencyStatusResponse,
} from "@impulza/contracts";
import {
  AgencyBillingChangeStatus,
  AgencyBillingMode,
  AgencyClientStatus,
  MembershipSource,
  MembershipStatus,
  OrganizationKind,
  type AgencyClient,
  type Organization,
  type PrismaClient,
  type User,
} from "@impulza/database";
import {
  AGENCY_LINK_REQUEST_TTL_DAYS,
  AGENCY_OWNER_INVITE_TTL_DAYS,
  nextAgencyClientStatus,
  type AgencyClientAction,
  type CreateAgencyClientDto,
  type LinkAgencyClientDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { PlansService } from "../plans/plans.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import { AgencyAccessService, relationGrantsAccess } from "./agency-access.service.js";

const DAY_MS = 24 * 3_600_000;

/** Lo que se lee de la organización del cliente junto a la relación (`publicHiddenAt`: la agencia ocultó su sitio público). */
const CLIENT_ORG_SELECT = { id: true, name: true, slug: true, publicHiddenAt: true } as const;
/** Relación con su cliente y con el cambio de facturación pendiente, si lo hay (a lo sumo uno: índice único parcial). */
const RELATION_INCLUDE = {
  clientOrganization: { select: CLIENT_ORG_SELECT },
  billingChanges: { where: { status: AgencyBillingChangeStatus.PENDING }, select: { toMode: true } },
} as const;
type RelationWithClient = AgencyClient & {
  clientOrganization: Pick<Organization, "id" | "name" | "slug" | "publicHiddenAt">;
  billingChanges: Array<{ toMode: AgencyBillingMode }>;
};

/** Códigos estables que el panel interpreta sin leer el mensaje. */
export const AGENCY_CODES = {
  NOT_AN_AGENCY: "NOT_AN_AGENCY",
  PLAN_REQUIRED: "AGENCY_PLAN_REQUIRED",
} as const;

/**
 * Modo agencia (F9.3, ADR-028 §2). La organización del cliente sigue siendo la unidad de aislamiento: este
 * servicio solo administra la **relación** y las membresías delegadas que de ella nacen. Quién entra a qué, y
 * con qué límites, lo decide `OrganizationMembershipGuard` en cada petición.
 */
@Injectable()
export class AgencyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly access: AgencyAccessService,
    private readonly revalidateWeb: RevalidateWebService,
  ) {}

  // ---- estado y activación ---------------------------------------------------------------------------------

  async getStatus(organizationId: string): Promise<AgencyStatusResponse> {
    const [organization, effective, clientsUsed, openLinks] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { kind: true } }),
      this.plans.resolveEffectivePlan(organizationId),
      this.prisma.agencyClient.count({ where: { agencyOrganizationId: organizationId, status: { not: AgencyClientStatus.ENDED } } }),
      this.prisma.agencyClient.count({ where: { clientOrganizationId: organizationId, status: { not: AgencyClientStatus.ENDED } } }),
    ]);
    const limit = effective.plan.limits.clients;
    return {
      kind: organization.kind,
      planIncludesAgency: limit !== 0,
      clientsUsed,
      clientsLimit: limit,
      isClient: openLinks > 0,
    };
  }

  /** Activa el modo agencia: solo con un plan que incluya cupo de clientes, y nunca en un negocio que ya es cliente. */
  async enable(organizationId: string, actorId: string): Promise<AgencyStatusResponse> {
    const status = await this.getStatus(organizationId);
    if (status.kind === OrganizationKind.AGENCY) return status;
    if (status.isClient) {
      throw new ConflictException("Este negocio es cliente de una agencia: no puede ser a la vez una agencia.");
    }
    if (!status.planIncludesAgency) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: AGENCY_CODES.PLAN_REQUIRED,
        message: "Tu plan no incluye el modo agencia. Cambia a un plan de agencia para administrar clientes.",
      });
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { kind: OrganizationKind.AGENCY } });
    await this.audit.record({ organizationId, actorId, action: "agency.enabled", targetType: "Organization", targetId: organizationId });
    return this.getStatus(organizationId);
  }

  async assertAgency(organizationId: string): Promise<Organization> {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.kind !== OrganizationKind.AGENCY) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: AGENCY_CODES.NOT_AN_AGENCY,
        message: "Esta organización no es una agencia. Activa el modo agencia primero.",
      });
    }
    return organization;
  }

  // ---- lado de la agencia ----------------------------------------------------------------------------------

  private toClientResponse(relation: RelationWithClient): AgencyClientResponse {
    const ownerAccepted = relation.ownerAcceptedAt !== null || !relation.agencyCreated;
    return {
      id: relation.id,
      clientOrganizationId: relation.clientOrganizationId,
      clientName: relation.clientOrganization.name,
      clientSlug: relation.clientOrganization.slug,
      status: relation.status,
      billingMode: relation.billingMode,
      agencyCreated: relation.agencyCreated,
      ownerInviteEmail: ownerAccepted ? null : relation.ownerInviteEmail,
      ownerInviteExpiresAt: ownerAccepted || !relation.ownerInviteExpiresAt ? null : relation.ownerInviteExpiresAt.toISOString(),
      ownerAccepted,
      readOnly: relation.status === AgencyClientStatus.PAUSED,
      publicHidden: relation.clientOrganization.publicHiddenAt !== null,
      pendingBillingMode: relation.billingChanges[0]?.toMode ?? null,
      createdAt: relation.createdAt.toISOString(),
      acceptedAt: relation.acceptedAt?.toISOString() ?? null,
      pausedAt: relation.pausedAt?.toISOString() ?? null,
      archivedAt: relation.archivedAt?.toISOString() ?? null,
    };
  }

  async listClients(agencyOrganizationId: string): Promise<AgencyClientResponse[]> {
    await this.assertAgency(agencyOrganizationId);
    const relations = await this.prisma.agencyClient.findMany({
      where: { agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      include: RELATION_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return relations.map((relation) => this.toClientResponse(relation));
  }

  /** Alta de un cliente nuevo: la agencia crea su organización y trabaja desde ya; el propietario recibe una invitación. */
  async createClient(agencyOrganizationId: string, actor: User, input: CreateAgencyClientDto): Promise<AgencyClientResponse> {
    const agency = await this.assertAgency(agencyOrganizationId);
    if (await this.prisma.organization.findUnique({ where: { slug: input.slug } })) {
      throw new ConflictException("Ese identificador ya está en uso.");
    }

    const { raw, hash } = generateVerificationToken();
    const now = new Date();
    const relation = await this.prisma.$transaction(async (tx) => {
      // El cupo se verifica dentro de la transacción y con un lock: dos altas simultáneas no pasan juntas el límite.
      await this.plans.assertWithinLimit(tx, agencyOrganizationId, "clients");
      const client = await tx.organization.create({ data: { name: input.name, slug: input.slug, kind: OrganizationKind.BUSINESS } });
      const created = await tx.agencyClient.create({
        data: {
          agencyOrganizationId,
          clientOrganizationId: client.id,
          status: AgencyClientStatus.INVITED,
          billingMode: input.billingMode,
          agencyCreated: true,
          requestedById: actor.id,
          ownerInviteEmail: input.ownerEmail,
          ownerInviteTokenHash: hash,
          ownerInviteExpiresAt: new Date(now.getTime() + AGENCY_OWNER_INVITE_TTL_DAYS * DAY_MS),
        },
        include: RELATION_INCLUDE,
      });
      await this.access.grantForClient(tx, created);
      return created;
    });

    await this.audit.record({
      organizationId: agencyOrganizationId,
      actorId: actor.id,
      action: "agency.client.created",
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { clientOrganizationId: relation.clientOrganizationId, billingMode: input.billingMode },
    });
    await this.audit.record({
      organizationId: relation.clientOrganizationId,
      actorId: actor.id,
      action: "agency.link.created",
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { agencyOrganizationId, agencyCreated: true },
    });

    // El correo sale después de confirmar: un fallo del proveedor no deshace el alta (el propietario se puede reinvitar).
    const inviteUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/invitaciones/agencia?token=${raw}`;
    await this.safeSend(input.ownerEmail, {
      subject: `${agency.name} te invita a administrar «${input.name}» — Impulza One`,
      text:
        `${agency.name} creó el espacio de «${input.name}» en Impulza One y te invita a ser su propietario.\n\n` +
        `Como propietario decides quién entra: la agencia trabaja con acceso delegado y puedes revocarlo cuando quieras.\n\n` +
        `Acepta la invitación (vence en ${AGENCY_OWNER_INVITE_TTL_DAYS} días): ${inviteUrl}`,
    });
    return this.toClientResponse(relation);
  }

  /** Solicitud de vínculo sobre un negocio que ya existe: sin acceso hasta que su propietario acepte. */
  async requestLink(agencyOrganizationId: string, actor: User, input: LinkAgencyClientDto): Promise<AgencyClientResponse> {
    const agency = await this.assertAgency(agencyOrganizationId);

    // Identificador + correo del propietario deben coincidir: así no se puede sondear qué organizaciones existen.
    const client = await this.prisma.organization.findFirst({
      where: {
        slug: input.clientSlug,
        kind: OrganizationKind.BUSINESS,
        memberships: { some: { status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT, role: { name: "OWNER" }, user: { email: input.ownerEmail } } },
      },
      select: { id: true, name: true, slug: true },
    });
    if (!client || client.id === agencyOrganizationId) {
      throw new NotFoundException("No encontramos un negocio con esos datos.");
    }

    const relation = await this.prisma.$transaction(async (tx) => {
      await this.plans.assertWithinLimit(tx, agencyOrganizationId, "clients");
      const open = await tx.agencyClient.findFirst({ where: { clientOrganizationId: client.id, status: { not: AgencyClientStatus.ENDED } } });
      if (open) {
        throw new ConflictException("Ese negocio ya trabaja con una agencia. Su propietario debe terminar esa relación primero.");
      }
      return tx.agencyClient.create({
        data: {
          agencyOrganizationId,
          clientOrganizationId: client.id,
          status: AgencyClientStatus.INVITED,
          agencyCreated: false,
          requestedById: actor.id,
        },
        include: RELATION_INCLUDE,
      });
    });

    await this.audit.record({
      organizationId: agencyOrganizationId,
      actorId: actor.id,
      action: "agency.client.link_requested",
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { clientOrganizationId: client.id },
    });
    await this.audit.record({
      organizationId: client.id,
      actorId: actor.id,
      action: "agency.link.requested",
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { agencyOrganizationId, agencyName: agency.name },
    });

    const owners = await this.prisma.membership.findMany({
      where: { organizationId: client.id, status: MembershipStatus.ACTIVE, role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    for (const owner of owners) {
      await this.safeSend(owner.user.email, {
        subject: `${agency.name} pide acceso a «${client.name}» — Impulza One`,
        text:
          `${agency.name} pide trabajar en «${client.name}» como agencia.\n\n` +
          `No tendrá acceso hasta que lo aceptes en Configuración › Agencia: ${env.APP_BASE_URL.replace(/\/$/, "")}/configuracion/agencia\n` +
          `Si no la reconoces, recházala. La solicitud vence en ${AGENCY_LINK_REQUEST_TTL_DAYS} días.`,
      });
    }
    return this.toClientResponse(relation);
  }

  private async getRelation(agencyOrganizationId: string, relationId: string): Promise<RelationWithClient> {
    const relation = await this.prisma.agencyClient.findFirst({
      where: { id: relationId, agencyOrganizationId },
      include: RELATION_INCLUDE,
    });
    if (!relation) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    return relation;
  }

  /**
   * Qué valor debe quedar en `publicHiddenAt` tras una transición: `undefined` = no tocar. Pausar/archivar obedecen a la
   * elección de la agencia (`true` oculta, `false` muestra, ausente conserva); cualquier otro destino muestra el sitio.
   */
  private nextPublicHiddenAt(next: AgencyClientStatus, hide: boolean | undefined, current: Date | null, now: Date): Date | null | undefined {
    if (next === AgencyClientStatus.PAUSED || next === AgencyClientStatus.ARCHIVED) {
      if (hide === undefined) return undefined;
      return hide ? (current ?? now) : null;
    }
    return null;
  }

  /** Avisa a apps/web para que la caché pública refleje que el sitio se ocultó o se mostró (no-op sin configurar). */
  private async revalidateClientSites(clientOrganizationId: string): Promise<void> {
    const sites = await this.prisma.site.findMany({ where: { organizationId: clientOrganizationId }, select: { id: true } });
    await Promise.all(sites.map((site) => this.revalidateWeb.revalidateSite(site.id)));
  }

  /** Pausar, reanudar, archivar, desarchivar o soltar a un cliente. Nada borra datos del cliente. */
  async actOnClient(
    agencyOrganizationId: string,
    actorId: string,
    relationId: string,
    action: AgencyClientAction,
    hidePublicSite?: boolean,
  ): Promise<AgencyClientResponse> {
    await this.assertAgency(agencyOrganizationId);
    const relation = await this.getRelation(agencyOrganizationId, relationId);
    const next = nextAgencyClientStatus(action, relation.status);
    if (!next) {
      throw new ConflictException(`No se puede ${ACTION_LABELS[action]} un cliente en estado ${relation.status}.`);
    }

    const now = new Date();
    let visibilityChanged = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.agencyClient.update({
        where: { id: relation.id },
        data: {
          status: next,
          ...(next === AgencyClientStatus.PAUSED ? { pausedAt: now } : {}),
          ...(next === AgencyClientStatus.ACTIVE ? { pausedAt: null, archivedAt: null } : {}),
          ...(next === AgencyClientStatus.ARCHIVED ? { archivedAt: now } : {}),
          ...(next === AgencyClientStatus.ENDED ? { endedAt: now, endedReason: "released_by_agency", ownerInviteTokenHash: null } : {}),
        },
        include: RELATION_INCLUDE,
      });
      // Archivar y soltar quitan el acceso delegado de inmediato; reanudar desde archivo lo devuelve.
      if (next === AgencyClientStatus.ARCHIVED || next === AgencyClientStatus.ENDED) {
        await this.access.revokeForClient(tx, relation.id);
      } else if (relationGrantsAccess(row)) {
        await this.access.grantForClient(tx, row);
      }
      // Sitio público: solo pausar/archivar lo pueden ocultar (y solo si la agencia lo pide); volver a ACTIVE o terminar
      // la relación siempre lo muestran de nuevo, para que nadie quede con su sitio apagado sin una relación que lo explique.
      const hiddenAt = this.nextPublicHiddenAt(next, hidePublicSite, row.clientOrganization.publicHiddenAt, now);
      if (hiddenAt !== undefined && hiddenAt?.getTime() !== row.clientOrganization.publicHiddenAt?.getTime()) {
        const org = await tx.organization.update({ where: { id: row.clientOrganizationId }, data: { publicHiddenAt: hiddenAt }, select: CLIENT_ORG_SELECT });
        visibilityChanged = true;
        return { ...row, clientOrganization: org };
      }
      return row;
    });
    if (visibilityChanged) await this.revalidateClientSites(relation.clientOrganizationId);

    await this.audit.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: `agency.client.${action}`,
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { clientOrganizationId: relation.clientOrganizationId, from: relation.status, to: next, publicHidden: updated.clientOrganization.publicHiddenAt !== null },
    });
    await this.audit.record({
      organizationId: relation.clientOrganizationId,
      actorId,
      action: `agency.link.${action}`,
      targetType: "AgencyClient",
      targetId: relation.id,
      metadata: { agencyOrganizationId, from: relation.status, to: next },
    });
    return this.toClientResponse(updated);
  }

  // ---- lado del negocio (propietario) ------------------------------------------------------------------------

  private async openRelationOf(clientOrganizationId: string) {
    return this.prisma.agencyClient.findFirst({
      where: { clientOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      include: { agencyOrganization: { select: { id: true, name: true } }, clientOrganization: { select: { publicHiddenAt: true } } },
    });
  }

  async getLink(clientOrganizationId: string): Promise<AgencyLinkResponse> {
    const relation = await this.openRelationOf(clientOrganizationId);
    if (!relation) return null;
    const delegated = await this.prisma.membership.findMany({
      where: { agencyClientId: relation.id, source: MembershipSource.AGENCY, status: MembershipStatus.ACTIVE },
      select: { role: { select: { name: true } }, user: { select: { email: true } } },
      orderBy: { invitedAt: "asc" },
    });
    return {
      id: relation.id,
      agencyOrganizationId: relation.agencyOrganizationId,
      agencyName: relation.agencyOrganization.name,
      status: relation.status,
      agencyCreated: relation.agencyCreated,
      billingMode: relation.billingMode,
      awaitingOwnerDecision: relation.status === AgencyClientStatus.INVITED && !relation.agencyCreated,
      requestedAt: relation.createdAt.toISOString(),
      acceptedAt: relation.acceptedAt?.toISOString() ?? null,
      publicHidden: relation.clientOrganization.publicHiddenAt !== null,
      delegatedMembers: delegated.map((member) => ({ email: member.user.email, role: member.role.name })),
    };
  }

  /** El propietario acepta la solicitud de una agencia: desde aquí la agencia entra con acceso delegado. */
  async acceptLink(clientOrganizationId: string, actorId: string): Promise<AgencyLinkResponse> {
    const relation = await this.openRelationOf(clientOrganizationId);
    if (!relation || relation.status !== AgencyClientStatus.INVITED || relation.agencyCreated) {
      throw new ConflictException("No hay una solicitud de agencia pendiente.");
    }
    if (relation.createdAt.getTime() + AGENCY_LINK_REQUEST_TTL_DAYS * DAY_MS < Date.now()) {
      throw new GoneException("La solicitud venció. Pide a la agencia que la envíe de nuevo.");
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.agencyClient.update({ where: { id: relation.id }, data: { status: AgencyClientStatus.ACTIVE, acceptedAt: new Date() } });
      await this.access.grantForClient(tx, row);
    });
    await this.recordBoth(relation, actorId, "agency.link.accepted");
    return this.getLink(clientOrganizationId);
  }

  async rejectLink(clientOrganizationId: string, actorId: string): Promise<void> {
    const relation = await this.openRelationOf(clientOrganizationId);
    if (!relation || relation.status !== AgencyClientStatus.INVITED || relation.agencyCreated) {
      throw new ConflictException("No hay una solicitud de agencia pendiente.");
    }
    await this.prisma.agencyClient.update({
      where: { id: relation.id },
      data: { status: AgencyClientStatus.ENDED, endedAt: new Date(), endedReason: "rejected_by_client" },
    });
    await this.recordBoth(relation, actorId, "agency.link.rejected");
  }

  /** Revocación por el propietario: inmediata. Las membresías delegadas se retiran y el guard niega desde la siguiente petición. */
  async revokeLink(clientOrganizationId: string, actorId: string): Promise<void> {
    const relation = await this.openRelationOf(clientOrganizationId);
    if (!relation) throw new NotFoundException("Este negocio no tiene una agencia vinculada.");
    await this.prisma.$transaction(async (tx) => {
      await tx.agencyClient.update({
        where: { id: relation.id },
        data: { status: AgencyClientStatus.ENDED, endedAt: new Date(), endedReason: "revoked_by_client", ownerInviteTokenHash: null },
      });
      await this.access.revokeForClient(tx, relation.id);
      // Si la agencia había ocultado el sitio, al revocar vuelve a verse: el propietario nunca queda con el sitio apagado.
      await tx.organization.update({ where: { id: clientOrganizationId }, data: { publicHiddenAt: null } });
    });
    if (relation.clientOrganization.publicHiddenAt !== null) await this.revalidateClientSites(clientOrganizationId);
    await this.recordBoth(relation, actorId, "agency.link.revoked");
  }

  private async recordBoth(relation: { id: string; agencyOrganizationId: string; clientOrganizationId: string }, actorId: string, action: string): Promise<void> {
    for (const organizationId of [relation.clientOrganizationId, relation.agencyOrganizationId]) {
      await this.audit.record({
        organizationId,
        actorId,
        action,
        targetType: "AgencyClient",
        targetId: relation.id,
        metadata: { agencyOrganizationId: relation.agencyOrganizationId, clientOrganizationId: relation.clientOrganizationId },
      });
    }
  }

  // ---- invitación al propietario de un cliente creado por la agencia -----------------------------------------

  /**
   * La persona invitada acepta ser propietaria del negocio que creó la agencia. El token es de un solo uso, vence y
   * solo vale para la cuenta cuyo correo es el invitado: un enlace reenviado a otra persona no sirve.
   */
  async acceptOwnerInvitation(user: User, token: string): Promise<AcceptOwnerInvitationResponse> {
    const relation = await this.prisma.agencyClient.findUnique({
      where: { ownerInviteTokenHash: hashToken(token) },
      include: { clientOrganization: { select: { id: true, name: true } } },
    });
    if (!relation || relation.status === AgencyClientStatus.ENDED) {
      throw new NotFoundException("La invitación no existe o ya no es válida.");
    }
    if (!relation.ownerInviteExpiresAt || relation.ownerInviteExpiresAt.getTime() < Date.now()) {
      throw new GoneException("La invitación venció. Pide a la agencia que te invite de nuevo.");
    }
    if (!relation.ownerInviteEmail || relation.ownerInviteEmail !== user.email.toLowerCase()) {
      // Mismo mensaje que «no existe»: no revelar a quién se invitó.
      throw new NotFoundException("La invitación no existe o ya no es válida.");
    }

    const ownerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: relation.clientOrganizationId } },
      });
      const owner = { roleId: ownerRole.id, status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT, agencyClientId: null, acceptedAt: new Date() };
      if (existing) {
        await tx.membership.update({ where: { id: existing.id }, data: owner });
      } else {
        await tx.membership.create({ data: { userId: user.id, organizationId: relation.clientOrganizationId, ...owner } });
      }
      await tx.agencyClient.update({
        where: { id: relation.id },
        data: {
          ownerAcceptedAt: new Date(),
          ownerInviteTokenHash: null, // un solo uso
          ...(relation.status === AgencyClientStatus.INVITED ? { status: AgencyClientStatus.ACTIVE, acceptedAt: new Date() } : {}),
        },
      });
    });

    await this.recordBoth(relation, user.id, "agency.owner.accepted");
    return { organizationId: relation.clientOrganization.id, organizationName: relation.clientOrganization.name };
  }

  // ---- utilidades --------------------------------------------------------------------------------------------

  private async safeSend(to: string, content: { subject: string; text: string }): Promise<void> {
    try {
      await this.email.send({ to, subject: content.subject, text: content.text });
    } catch (error) {
      logger.error("agency: no se pudo enviar un correo", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const ACTION_LABELS: Record<AgencyClientAction, string> = {
  pause: "pausar",
  resume: "reanudar",
  archive: "archivar",
  unarchive: "desarchivar",
  release: "soltar",
};
