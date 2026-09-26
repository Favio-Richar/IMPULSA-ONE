import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma as PrismaTypes, PrismaClient, Theme } from "@impulza/database";
import { DEFAULT_THEME_CODE, getCatalogTheme, themeTokensSchema, type ThemeFamily, type ThemeTokens } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";

/**
 * Tema tal como lo devuelve la API. `source` y `editable` existen para que la interfaz no tenga
 * que deducir de `code`/`organizationId` qué puede hacer el usuario con cada fila: los temas del
 * catálogo se ven y se aplican, pero solo se editan duplicándolos.
 */
export interface ThemeView {
  id: string;
  name: string;
  code: string | null;
  source: "catalog" | "organization";
  /** Línea del catálogo (PP4) para agrupar en el panel; `null` en un tema propio. */
  family: ThemeFamily | null;
  editable: boolean;
  tokens: unknown;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ThemesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private toView(theme: Theme): ThemeView {
    const isCatalog = theme.organizationId === null;

    return {
      id: theme.id,
      name: theme.name,
      code: theme.code,
      source: isCatalog ? "catalog" : "organization",
      // Sale del catálogo en código y no de una columna: es presentación, no dato del tenant, y así
      // reordenar las líneas no pide migración.
      family: isCatalog && theme.code !== null ? (getCatalogTheme(theme.code)?.family ?? null) : null,
      editable: !isCatalog,
      tokens: theme.tokens,
      createdAt: theme.createdAt,
      updatedAt: theme.updatedAt,
    };
  }

  /**
   * Única puerta de entrada de tokens a la base. Valida forma **y** contraste WCAG 2.2 AA en el
   * servidor: el objetivo de accesibilidad del proyecto no puede depender de que el cliente haya
   * corrido la misma comprobación, y un tema ilegible guardado es una página pública rota.
   */
  private parseTokens(tokens: unknown): ThemeTokens {
    const parsed = themeTokensSchema.safeParse(tokens);

    if (!parsed.success) {
      throw new UnprocessableEntityException({
        message: "Los tokens del tema no son válidos.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return parsed.data;
  }

  /**
   * Resuelve un tema **visible para la organización**: los del catálogo global (`organizationId`
   * null) y los propios. El tema de otra organización devuelve 404 y no 403, para no confirmar su
   * existencia — mismo criterio que sitios y páginas (ADR-002, F1.9).
   */
  private async getVisibleThemeOrThrow(organizationId: string, themeId: string): Promise<Theme> {
    const theme = await this.prisma.theme.findFirst({
      where: { id: themeId, OR: [{ organizationId: null }, { organizationId }] },
    });

    if (!theme) {
      throw new NotFoundException("Tema no encontrado.");
    }

    return theme;
  }

  /** Igual que el anterior, pero además exige que el tema sea propio: el catálogo es de solo lectura. */
  private async getOwnThemeOrThrow(organizationId: string, themeId: string): Promise<Theme> {
    const theme = await this.getVisibleThemeOrThrow(organizationId, themeId);

    if (theme.organizationId === null) {
      throw new ForbiddenException(
        "Los temas del catálogo no se pueden modificar. Duplícalo para tener una copia editable.",
      );
    }

    return theme;
  }

  /**
   * Comprobación que usa `SitesService` antes de aplicar un tema a un sitio. Está acá y no allá
   * porque la regla "qué temas puede usar esta organización" es de este módulo: si mañana hay
   * temas compartidos por plan, se cambia en un solo lugar.
   */
  async assertThemeApplicable(organizationId: string, themeId: string): Promise<Theme> {
    return this.getVisibleThemeOrThrow(organizationId, themeId);
  }

  async listThemes(organizationId: string): Promise<ThemeView[]> {
    const themes = await this.prisma.theme.findMany({
      where: { OR: [{ organizationId: null }, { organizationId }] },
      // El catálogo primero (organizationId null ordena antes en ascendente con nulls first en
      // Postgres solo si se pide; se ordena explícitamente para no depender de eso).
      orderBy: [{ organizationId: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    });

    return themes.map((theme) => this.toView(theme));
  }

  async getTheme(organizationId: string, themeId: string): Promise<ThemeView> {
    return this.toView(await this.getVisibleThemeOrThrow(organizationId, themeId));
  }

  /**
   * Tema efectivo de un sitio: el aplicado, o el del catálogo por defecto cuando el sitio todavía
   * no eligió ninguno. El render público (F2.7) y el constructor necesitan la misma respuesta, así
   * que la regla de "qué se ve si no elegiste" vive en el servidor y no duplicada en cada cliente.
   */
  async getDefaultTheme(): Promise<Theme> {
    const fallback = await this.prisma.theme.findFirst({
      where: { code: DEFAULT_THEME_CODE, organizationId: null },
    });

    if (!fallback) {
      // El catálogo lo siembra `packages/database/prisma/seed.ts`. Si falta, el entorno está mal
      // preparado: es mejor un error explícito que servir una página sin estilos.
      throw new NotFoundException(
        `El tema por defecto "${DEFAULT_THEME_CODE}" no está en la base. ¿Se ejecutó el seed?`,
      );
    }

    return fallback;
  }

  async createTheme(
    organizationId: string,
    actorId: string,
    input: { name: string; tokens: unknown },
  ): Promise<ThemeView> {
    const tokens = this.parseTokens(input.tokens);

    const theme = await this.prisma.theme.create({
      data: {
        organizationId,
        // `code` es solo para los temas del catálogo (hace idempotente el seed). Los propios lo
        // dejan en null: Postgres admite múltiples NULL bajo un índice único.
        code: null,
        name: input.name,
        tokens: tokens as unknown as PrismaTypes.InputJsonValue,
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "theme.created",
      targetType: "Theme",
      targetId: theme.id,
      metadata: { name: theme.name },
    });

    return this.toView(theme);
  }

  /**
   * Duplicar es el único camino para personalizar un tema del catálogo, y por eso existe: sin él,
   * "elige tokens de un conjunto validado" obligaría al usuario a reescribir la paleta entera a
   * mano para cambiar un color.
   */
  async duplicateTheme(
    organizationId: string,
    actorId: string,
    themeId: string,
    name?: string,
  ): Promise<ThemeView> {
    const source = await this.getVisibleThemeOrThrow(organizationId, themeId);
    // Se revalidan los tokens del origen en vez de copiarlos a ciegas: si el tema se guardó con
    // una versión anterior del esquema, la copia no puede heredar algo que hoy sería inválido.
    const tokens = this.parseTokens(source.tokens);

    const copy = await this.prisma.theme.create({
      data: {
        organizationId,
        code: null,
        name: name ?? `${source.name} (copia)`,
        tokens: tokens as unknown as PrismaTypes.InputJsonValue,
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "theme.duplicated",
      targetType: "Theme",
      targetId: copy.id,
      metadata: { sourceThemeId: source.id, sourceCode: source.code },
    });

    return this.toView(copy);
  }

  async updateTheme(
    organizationId: string,
    actorId: string,
    themeId: string,
    changes: { name?: string; tokens?: unknown },
  ): Promise<ThemeView> {
    const theme = await this.getOwnThemeOrThrow(organizationId, themeId);
    const tokens = changes.tokens === undefined ? null : this.parseTokens(changes.tokens);

    const updated = await this.prisma.theme.update({
      where: { id: theme.id },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(tokens === null ? {} : { tokens: tokens as unknown as PrismaTypes.InputJsonValue }),
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "theme.updated",
      targetType: "Theme",
      targetId: theme.id,
      metadata: { nameChanged: changes.name !== undefined, tokensChanged: tokens !== null },
    });

    return this.toView(updated);
  }

  /**
   * Un tema aplicado no se borra. Prisma tiene `onDelete: SetNull` en `Site.themeId`, así que
   * borrarlo dejaría los sitios afectados cambiando de apariencia en silencio — exactamente el
   * tipo de destrucción callada de trabajo del usuario que CLAUDE.md prohíbe. El usuario primero
   * cambia esos sitios de tema y después lo elimina.
   */
  async deleteTheme(organizationId: string, actorId: string, themeId: string): Promise<void> {
    const theme = await this.getOwnThemeOrThrow(organizationId, themeId);

    // A propósito sin filtrar por organización: si por un error de datos un sitio ajeno apuntara
    // a este tema, queremos que el borrado se detenga igual.
    const sitesUsing = await this.prisma.site.count({ where: { themeId: theme.id } });

    if (sitesUsing > 0) {
      throw new ConflictException(
        `Este tema está aplicado en ${sitesUsing} sitio(s). Cámbialos de tema antes de eliminarlo.`,
      );
    }

    await this.prisma.theme.delete({ where: { id: theme.id } });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "theme.deleted",
      targetType: "Theme",
      targetId: theme.id,
      metadata: { name: theme.name },
    });
  }
}
