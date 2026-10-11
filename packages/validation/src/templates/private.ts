import { z } from "zod";

/**
 * Plantillas privadas (F9.7c, ADR-028). Una organización —o una agencia— guarda una de sus páginas como plantilla **visible solo para
 * ella** (`Template.organizationId`). Lo que se copia al guardar nunca arrastra referencias a recursos de la organización de origen: un
 * formulario, un servicio o un producto de ella no existen en la que aplique la plantilla (ni deben filtrarse sus identificadores).
 */

export const PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX = 50;

export const createPrivateTemplateSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(80, "Máximo 80 caracteres."),
  description: z.string().trim().min(10, "Cuenta en al menos 10 caracteres para qué sirve.").max(300, "Máximo 300 caracteres."),
  siteId: z.uuid(),
  pageId: z.uuid(),
  /** Guardar también el tema y el fondo del sitio (si son del catálogo); si no, solo los bloques. */
  includeAppearance: z.boolean().default(true),
});
export type CreatePrivateTemplateDto = z.infer<typeof createPrivateTemplateSchema>;

/** Campos de configuración de bloque que apuntan a datos de UNA organización y por eso no viajan en una plantilla. */
const FORM_REFERENCE_KEYS = ["formId"] as const;
const LIST_REFERENCE_KEYS = ["serviceIds", "productIds"] as const;
const SINGLE_REFERENCE_KEYS = ["categoryId"] as const;

/**
 * Devuelve la configuración de un bloque sin referencias a recursos de su organización: `formId` pasa a `null` (el estado «sin
 * configurar» del bloque de formulario), y las listas y la categoría de servicios y productos se quitan (sin ellas el bloque ofrece
 * todo lo activo del sitio que la use). No muta la entrada y recorre solo el primer nivel, que es donde el catálogo de bloques las declara.
 */
export function stripOrganizationReferences(config: unknown): unknown {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return config;
  const copy: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const key of FORM_REFERENCE_KEYS) if (key in copy) copy[key] = null;
  for (const key of [...LIST_REFERENCE_KEYS, ...SINGLE_REFERENCE_KEYS]) delete copy[key];
  return copy;
}

/** Texto a minúsculas con guiones, para el código de la plantilla. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Código de una plantilla privada: `p-<8 del id de la organización>-<nombre>-<aleatorio>`. El prefijo lo distingue de las del catálogo
 * (que nunca empiezan por `p-` + 8 hexadecimales) y el sufijo evita choques entre nombres iguales. Siempre cumple `templateCodeSchema`.
 */
export function privateTemplateCode(organizationId: string, name: string, random: string): string {
  const owner = organizationId.replace(/-/g, "").slice(0, 8).toLowerCase();
  const slug = slugify(name).slice(0, 30).replace(/-+$/g, "") || "plantilla";
  const suffix = random.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "x";
  return `p-${owner}-${slug}-${suffix}`.slice(0, 60);
}

/** ¿El código es de una plantilla privada de ESTA organización? (solo por forma; la pertenencia real la fija la base de datos). */
export function isPrivateTemplateCode(code: string): boolean {
  return /^p-[0-9a-f]{8}-/.test(code);
}
