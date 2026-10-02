import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@impulza/database";
import { SYSTEM_FEATURE_FLAGS, type SystemFeatureFlagKey } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";

/** Lo que ve quien intenta usar una función que el superadministrador apagó. */
export const FEATURE_DISABLED_MESSAGES: Record<SystemFeatureFlagKey, string> = {
  registros_abiertos: "El registro de cuentas nuevas está cerrado por el momento. Intenta de nuevo más tarde.",
  pagos_en_linea: "Los pagos en línea están pausados por el momento. Intenta de nuevo más tarde.",
  ia_generativa: "El asistente de IA está pausado por el momento.",
  campanas_correo: "El envío de campañas por correo está pausado por el momento.",
  sincronizacion_calendarios: "La sincronización de calendarios está pausada por el momento.",
  webhooks_salientes: "Los webhooks salientes están pausados por el momento.",
};

interface FlagData {
  enabled: boolean;
  rules: Record<string, unknown> | null;
}

const CACHE_TTL_SECONDS = 60;
const cacheKey = (key: string): string => `feature_flag:${key}`;

/**
 * Evaluación de las banderas de funcionalidad (F7.11, ADR-026). Reglas de diseño:
 * - Una bandera sin fila en la base vale lo que dice `SYSTEM_FEATURE_FLAGS` (`defaultEnabled`): nunca
 *   "apagada", o el primer arranque bloquearía registros, pagos y todo lo demás.
 * - Si Redis o la base fallan, la función sigue disponible (se registra el aviso): un fallo de
 *   infraestructura no debe apagar la plataforma. El interruptor existe para que lo accione una persona.
 * - Las reglas por organización: con `allowedOrganizations` no vacía solo esas organizaciones la
 *   tienen; si no, `blockedOrganizations` las excluye.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private defaultFor(key: string): boolean {
    return SYSTEM_FEATURE_FLAGS.find((flag) => flag.key === key)?.defaultEnabled ?? true;
  }

  private async load(key: string): Promise<FlagData> {
    try {
      const cached = await this.redis.get(cacheKey(key));
      if (cached) {
        return JSON.parse(cached) as FlagData;
      }
    } catch (error) {
      logger.warn("feature_flags: no se pudo leer la caché; se consulta la base", { key, error });
    }
    try {
      const row = await this.prisma.featureFlag.findUnique({ where: { key } });
      const data: FlagData = row
        ? { enabled: row.enabled, rules: (row.rules as Record<string, unknown> | null) ?? null }
        : { enabled: this.defaultFor(key), rules: null };
      await this.redis.set(cacheKey(key), JSON.stringify(data), "EX", CACHE_TTL_SECONDS).catch(() => undefined);
      return data;
    } catch (error) {
      logger.warn("feature_flags: no se pudo leer la bandera; se usa su valor por defecto", { key, error });
      return { enabled: this.defaultFor(key), rules: null };
    }
  }

  /** `key` es una de `SYSTEM_FEATURE_FLAGS` (las rutas la fijan con `RequireFeature`, que sí la tipa). */
  async isEnabled(key: string, organizationId?: string): Promise<boolean> {
    const flag = await this.load(key);
    if (!flag.enabled) return false;
    if (!organizationId || !flag.rules) return true;

    const allowed = flag.rules.allowedOrganizations;
    if (Array.isArray(allowed) && allowed.length > 0) {
      return allowed.includes(organizationId);
    }
    const blocked = flag.rules.blockedOrganizations;
    if (Array.isArray(blocked) && blocked.length > 0) {
      return !blocked.includes(organizationId);
    }
    return true;
  }

  /** Borra la caché de una bandera: el cambio del superadministrador rige de inmediato. */
  async invalidate(key: string): Promise<void> {
    await this.redis.del(cacheKey(key)).catch(() => undefined);
  }
}
