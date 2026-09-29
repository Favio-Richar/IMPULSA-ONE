import { randomBytes } from "node:crypto";
import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { AbTest, PrismaClient } from "@impulza/database";
import {
  AB_CLICK_EVENTS,
  AB_CONVERSION_EVENTS,
  AB_EXPOSURE_EVENTS,
  AB_MIN_EXPOSURES_PER_VARIANT,
  AB_MIN_TOTAL_CLICKS,
  abVariantSchema,
  applyAbVariant,
  evaluateAbTest,
  getBlockDefinition,
  isAbTestBlockType,
  type AbVariantCounts,
  type CreateAbTestInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { BlocksService } from "../blocks/blocks.service.js";
import { pageContentSnapshotSchema } from "../pages/page-content-snapshot.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { PlansService } from "../plans/plans.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";

export const AB_BLOCK_NOT_SUPPORTED = "AB_BLOCK_NOT_SUPPORTED";
export const AB_BLOCK_NOT_PUBLISHED = "AB_BLOCK_NOT_PUBLISHED";
export const AB_VARIANT_INVALID = "AB_VARIANT_INVALID";
export const AB_TEST_ALREADY_RUNNING = "AB_TEST_ALREADY_RUNNING";

function unprocessable(code: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ statusCode: HttpStatus.UNPROCESSABLE_ENTITY, error: "Unprocessable Entity", code, message });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Pruebas A/B (F6.5, ADR-011). Crear, terminar y aplicar son acciones explícitas del usuario; el
 * reparto lo hace `apps/web` con el grupo del visitante y el conteo `AnalyticsService` (métricas
 * `ab:*` en `AnalyticsAggregate`). Aplicar la variante B escribe el borrador del bloque por la
 * edición normal (validación, sanitización, versión) y nunca publica.
 *
 * Todo se busca dentro del sitio ya verificado en `organizationId` (ADR-002).
 */
@Injectable()
export class AbTestsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
    private readonly blocksService: BlocksService,
    private readonly revalidateWeb: RevalidateWebService,
  ) {}

  async list(organizationId: string, siteId: string) {
    await this.assertSite(organizationId, siteId);
    const tests = await this.prisma.abTest.findMany({
      where: { organizationId, siteId },
      orderBy: [{ status: "desc" }, { startedAt: "desc" }],
    });
    const counts = await this.countsFor(organizationId, siteId, tests.map((test) => test.id));
    return tests.map((test) => this.toResponse(test, counts.get(test.id)));
  }

  async get(organizationId: string, siteId: string, testId: string) {
    const test = await this.getOrThrow(organizationId, siteId, testId);
    const counts = await this.countsFor(organizationId, siteId, [test.id]);
    return this.toResponse(test, counts.get(test.id));
  }

  async create(organizationId: string, actorId: string, siteId: string, input: CreateAbTestInput) {
    await this.assertSite(organizationId, siteId);
    const block = await this.prisma.block.findFirst({
      where: { id: input.blockId, page: { siteId, deletedAt: null, site: { organizationId } } },
      select: { id: true, type: true, pageId: true },
    });
    if (!block) {
      throw new NotFoundException("Bloque no encontrado.");
    }
    if (!isAbTestBlockType(block.type)) {
      throw unprocessable(AB_BLOCK_NOT_SUPPORTED, "Solo se pueden probar botones de acción (enlace, WhatsApp, reservas, tienda) o el encabezado de perfil.");
    }

    // Se compara contra lo que ven los visitantes: el bloque tiene que estar publicado.
    const published = await this.publishedConfig(block.pageId, block.id);
    if (published === null) {
      throw unprocessable(AB_BLOCK_NOT_PUBLISHED, "Publica la página con este bloque antes de probarlo: la variante A es lo que ya ven tus visitantes.");
    }
    const parsedVariant = abVariantSchema(block.type).safeParse(input.variantB);
    if (!parsedVariant.success) {
      throw unprocessable(AB_VARIANT_INVALID, parsedVariant.error.issues[0]?.message ?? "La variante B no es válida.");
    }
    const variantB = parsedVariant.data as Record<string, unknown>;
    const merged = applyAbVariant(published, variantB);
    if (!getBlockDefinition(block.type)!.schema.safeParse(merged).success) {
      throw unprocessable(AB_VARIANT_INVALID, "Con esos cambios el bloque no sería válido.");
    }
    const current = published as Record<string, unknown>;
    if (Object.entries(variantB).every(([field, value]) => current[field] === value)) {
      throw unprocessable(AB_VARIANT_INVALID, "La variante B es igual a la A: cambia al menos un texto o el estilo.");
    }

    // Antes que el límite del plan: "este bloque ya tiene una" es el motivo más útil. El índice
    // parcial sigue siendo la garantía ante dos solicitudes simultáneas (ver el `catch` de abajo).
    if (await this.prisma.abTest.findFirst({ where: { blockId: block.id, status: "RUNNING" }, select: { id: true } })) {
      throw this.alreadyRunning();
    }
    await this.enforcePlanLimit(organizationId);

    let test: AbTest;
    try {
      test = await this.prisma.abTest.create({
        data: {
          organizationId,
          siteId,
          pageId: block.pageId,
          blockId: block.id,
          blockType: block.type,
          name: input.name,
          key: randomBytes(9).toString("base64url"),
          variantA: current as object,
          variantB: variantB as object,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.alreadyRunning();
      }
      throw error;
    }

    await this.auditService.record({ organizationId, actorId, action: "ab_test.started", targetType: "AbTest", targetId: test.id, metadata: { name: test.name, blockType: test.blockType, fields: Object.keys(variantB) } });
    logger.info("prueba A/B iniciada", { organizationId, siteId, testId: test.id, blockType: test.blockType });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.toResponse(test, undefined);
  }

  async stop(organizationId: string, actorId: string, siteId: string, testId: string) {
    const test = await this.getOrThrow(organizationId, siteId, testId);
    if (test.status === "ENDED") {
      return this.get(organizationId, siteId, testId);
    }
    // Condicional por estado: dos "terminar" simultáneos no pisan `endedAt`.
    await this.prisma.abTest.updateMany({ where: { id: test.id, status: "RUNNING" }, data: { status: "ENDED", endedAt: new Date() } });
    await this.auditService.record({ organizationId, actorId, action: "ab_test.ended", targetType: "AbTest", targetId: test.id });
    logger.info("prueba A/B terminada", { organizationId, siteId, testId: test.id });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.get(organizationId, siteId, testId);
  }

  /**
   * Termina la prueba (si seguía en curso) y aplica la variante elegida. B se escribe sobre el
   * **borrador actual** del bloque (así no se pierden otros cambios sin publicar) por la edición
   * normal; A deja el bloque como está. En ambos casos el cambio llega a los visitantes al publicar.
   */
  async apply(organizationId: string, actorId: string, siteId: string, testId: string, variant: "a" | "b") {
    const test = await this.getOrThrow(organizationId, siteId, testId);
    // Idempotente: una prueba ya aplicada no se vuelve a aplicar (doble clic, dos pestañas). La
    // decisión tomada no cambia ni se reescribe el borrador otra vez.
    if (test.appliedVariant !== null) {
      return this.get(organizationId, siteId, testId);
    }
    if (variant === "b") {
      const draft = await this.prisma.blockVersion.findFirst({ where: { blockId: test.blockId }, orderBy: { versionNumber: "desc" }, select: { config: true } });
      await this.blocksService.updateBlock(organizationId, actorId, siteId, test.pageId, test.blockId, {
        config: applyAbVariant(draft?.config ?? {}, test.variantB as Record<string, unknown>),
      });
    }
    await this.prisma.abTest.update({
      where: { id: test.id },
      data: { status: "ENDED", endedAt: test.endedAt ?? new Date(), appliedVariant: variant },
    });
    await this.auditService.record({ organizationId, actorId, action: "ab_test.applied", targetType: "AbTest", targetId: test.id, metadata: { variant } });
    logger.info("variante de prueba A/B aplicada", { organizationId, siteId, testId: test.id, variant });
    if (test.status === "RUNNING") {
      await this.revalidateWeb.revalidateSite(siteId);
    }
    return this.get(organizationId, siteId, testId);
  }

  // --- internos -----------------------------------------------------------------------------------

  private alreadyRunning(): ConflictException {
    return new ConflictException({ statusCode: HttpStatus.CONFLICT, error: "Conflict", code: AB_TEST_ALREADY_RUNNING, message: "Este bloque ya tiene una prueba en curso." });
  }

  private async assertSite(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async getOrThrow(organizationId: string, siteId: string, testId: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findFirst({ where: { id: testId, organizationId, siteId } });
    if (!test) {
      throw new NotFoundException("Prueba no encontrada.");
    }
    return test;
  }

  private async enforcePlanLimit(organizationId: string): Promise<void> {
    const { plan } = await this.plansService.resolveEffectivePlan(organizationId);
    const limit = plan.limits.abTestsRunning;
    if (limit === null) {
      return;
    }
    const running = await this.prisma.abTest.count({ where: { organizationId, status: "RUNNING" } });
    if (running >= limit) {
      throw new PlanLimitExceededException("abTestsRunning", limit, running, { code: plan.code, name: plan.name });
    }
  }

  /** Configuración del bloque en la última versión publicada de su página, o `null` si no está. */
  private async publishedConfig(pageId: string, blockId: string): Promise<unknown | null> {
    const version = await this.prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { versionNumber: "desc" }, select: { contentSnapshot: true } });
    const snapshot = version ? pageContentSnapshotSchema.safeParse(version.contentSnapshot) : null;
    if (!snapshot?.success) {
      return null;
    }
    return snapshot.data.blocks.find((block) => block.id === blockId)?.config ?? null;
  }

  /** Suma las métricas `ab:<evento>:<prueba>:<variante>` de todos los días. */
  private async countsFor(organizationId: string, siteId: string, testIds: string[]): Promise<Map<string, { a: AbVariantCounts; b: AbVariantCounts }>> {
    const result = new Map<string, { a: AbVariantCounts; b: AbVariantCounts }>();
    if (testIds.length === 0) {
      return result;
    }
    const rows = await this.prisma.analyticsAggregate.groupBy({
      by: ["metric"],
      where: { organizationId, siteId, metric: { startsWith: "ab:" }, OR: testIds.map((id) => ({ metric: { contains: `:${id}:` } })) },
      _sum: { value: true },
    });
    const empty = (): AbVariantCounts => ({ exposures: 0, clicks: 0, conversions: 0 });
    for (const id of testIds) {
      result.set(id, { a: empty(), b: empty() });
    }
    for (const row of rows) {
      const [, eventType, testId, variant] = row.metric.split(":");
      const entry = testId ? result.get(testId) : undefined;
      if (!entry || (variant !== "a" && variant !== "b") || !eventType) {
        continue;
      }
      const value = row._sum.value ?? 0;
      if ((AB_EXPOSURE_EVENTS as readonly string[]).includes(eventType)) {
        entry[variant].exposures += value;
      } else if ((AB_CLICK_EVENTS as readonly string[]).includes(eventType)) {
        entry[variant].clicks += value;
      } else if ((AB_CONVERSION_EVENTS as readonly string[]).includes(eventType)) {
        entry[variant].conversions += value;
      }
    }
    return result;
  }

  private toResponse(test: AbTest, counts: { a: AbVariantCounts; b: AbVariantCounts } | undefined) {
    const a = counts?.a ?? { exposures: 0, clicks: 0, conversions: 0 };
    const b = counts?.b ?? { exposures: 0, clicks: 0, conversions: 0 };
    return {
      id: test.id,
      siteId: test.siteId,
      pageId: test.pageId,
      blockId: test.blockId,
      blockType: test.blockType,
      name: test.name,
      status: test.status,
      variantA: test.variantA as Record<string, unknown>,
      variantB: test.variantB as Record<string, unknown>,
      appliedVariant: (test.appliedVariant as "a" | "b" | null) ?? null,
      startedAt: test.startedAt,
      endedAt: test.endedAt,
      results: {
        a,
        b,
        ...evaluateAbTest(a, b),
        minimum: { exposuresPerVariant: AB_MIN_EXPOSURES_PER_VARIANT, totalClicks: AB_MIN_TOTAL_CLICKS },
      },
    };
  }
}
