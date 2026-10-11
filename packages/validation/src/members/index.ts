import { z } from "zod";
import { cleanPlainText } from "../moderation/abuse-report.js";

/**
 * Miembros de sitio y contenido protegido (F10.1, ADR-029). Reglas compartidas por la API, `apps/web` y el panel.
 * Nada de acá se decide solo en el frontend: el servidor vuelve a aplicarlo siempre.
 */

/** Vida del enlace mágico: lo justo para abrir el correo; después hay que pedir otro. */
export const MEMBER_LOGIN_TOKEN_TTL_MINUTES = 15;
/** Vida de la sesión del miembro. Fija (no se renueva sola): pasado el plazo, vuelve a pedir su enlace. */
export const MEMBER_SESSION_TTL_DAYS = 30;
/** Miembros por sitio: acota lo que una cuenta comprometida puede dar de alta. */
export const MEMBERS_PER_SITE_MAX = 5000;
export const MEMBER_NAME_MAX = 120;
export const MEMBER_SEARCH_MAX = 120;

/** Correo de miembro: minúsculas y sin espacios; la base lo exige también con un `CHECK`. */
export const memberEmailSchema = z
  .string()
  .trim()
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo válido."))
  .transform((value) => value.toLowerCase());

const optionalName = z
  .string()
  .max(MEMBER_NAME_MAX * 2)
  .transform(cleanPlainText)
  .pipe(z.string().max(MEMBER_NAME_MAX, `Máximo ${MEMBER_NAME_MAX} caracteres.`));

/** El visitante pide su enlace: solo el correo. La respuesta no revela si existe como miembro. */
export const requestMemberAccessSchema = z.object({ email: memberEmailSchema }).strict();
export type RequestMemberAccessDto = z.infer<typeof requestMemberAccessSchema>;

/** Token de un solo uso o de sesión: 32 bytes en base64url = 43 caracteres. Cualquier otra forma ni se consulta. */
export const MEMBER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const memberTokenSchema = z.string().regex(MEMBER_TOKEN_PATTERN, "Enlace no válido.");

export const verifyMemberAccessSchema = z.object({ token: memberTokenSchema }).strict();
export type VerifyMemberAccessDto = z.infer<typeof verifyMemberAccessSchema>;

/** Alta de un miembro desde el panel. */
export const addMemberSchema = z
  .object({
    email: memberEmailSchema,
    name: optionalName.optional(),
    /** Envía el enlace de acceso por correo al darlo de alta (por defecto, sí). */
    sendAccess: z.boolean().default(true),
  })
  .strict();
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const listMembersQuerySchema = z.object({
  search: z.string().trim().max(MEMBER_SEARCH_MAX).optional(),
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListMembersQueryDto = z.infer<typeof listMembersQuerySchema>;

export const setPageMembersOnlySchema = z.object({ enabled: z.boolean() }).strict();
export type SetPageMembersOnlyDto = z.infer<typeof setPageMembersOnlySchema>;

/** Nombre de la cookie de sesión del miembro en `apps/web`: una por sitio, nunca compartida entre sitios. */
export function memberCookieName(siteSlug: string): string {
  return `impulza_member_${siteSlug}`;
}

// ───────────────────────────── F10.2: planes de membresía ─────────────────────────────

export const MEMBERSHIP_PERIODS = ["MONTHLY", "YEARLY"] as const;
export type MembershipPeriodValue = (typeof MEMBERSHIP_PERIODS)[number];
export const MEMBERSHIP_PERIOD_DAYS: Record<MembershipPeriodValue, number> = { MONTHLY: 30, YEARLY: 365 };
export const MEMBERSHIP_PERIOD_LABELS: Record<MembershipPeriodValue, string> = { MONTHLY: "al mes", YEARLY: "al año" };
export const MEMBERSHIP_PLANS_PER_SITE_MAX = 10;
export const MEMBERSHIP_PRICE_MAX = 100_000_000;
export const MEMBERSHIP_PLAN_NAME_MAX = 80;
export const MEMBERSHIP_PLAN_DESCRIPTION_MAX = 500;

const planName = z
  .string()
  .max(MEMBERSHIP_PLAN_NAME_MAX * 2)
  .transform(cleanPlainText)
  .pipe(z.string().min(2, "Ponle un nombre al plan.").max(MEMBERSHIP_PLAN_NAME_MAX, `Máximo ${MEMBERSHIP_PLAN_NAME_MAX} caracteres.`));

const planDescription = z
  .string()
  .max(MEMBERSHIP_PLAN_DESCRIPTION_MAX * 2)
  .transform(cleanPlainText)
  .pipe(z.string().max(MEMBERSHIP_PLAN_DESCRIPTION_MAX, `Máximo ${MEMBERSHIP_PLAN_DESCRIPTION_MAX} caracteres.`));

/** Precio en la unidad mínima de la moneda (ST §8): entero positivo, nunca decimal. */
const planPrice = z
  .number({ error: "Escribe el precio." })
  .int("El precio debe ser un número entero.")
  .min(1, "El precio debe ser mayor que cero.")
  .max(MEMBERSHIP_PRICE_MAX, "El precio es demasiado alto.");

const planCurrency = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Usa el código de moneda de 3 letras, por ejemplo CLP."));

export const createMembershipPlanSchema = z
  .object({
    name: planName,
    description: planDescription.optional(),
    priceAmount: planPrice,
    priceCurrency: planCurrency.default("CLP"),
    period: z.enum(MEMBERSHIP_PERIODS, { error: "Elige si se cobra al mes o al año." }),
  })
  .strict();
export type CreateMembershipPlanDto = z.infer<typeof createMembershipPlanSchema>;

export const updateMembershipPlanSchema = z
  .object({
    name: planName.optional(),
    description: planDescription.nullable().optional(),
    priceAmount: planPrice.optional(),
    priceCurrency: planCurrency.optional(),
    period: z.enum(MEMBERSHIP_PERIODS).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Envía al menos un campo a modificar." });
export type UpdateMembershipPlanDto = z.infer<typeof updateMembershipPlanSchema>;

/** Quien compra: correo y, opcionalmente, nombre. El precio nunca viene del cliente: sale del plan guardado. */
export const startMembershipCheckoutSchema = z.object({ email: memberEmailSchema, name: optionalName.optional() }).strict();
export type StartMembershipCheckoutDto = z.infer<typeof startMembershipCheckoutSchema>;

/** Compra de un periodo, tal como la necesita la regla de acceso. */
export interface PurchaseForAccess {
  status: "PENDING" | "PAID" | "EXPIRED";
  paymentStatus: string | null;
  amount: number;
  refundedAmount: number;
  periodEnd: Date | null;
}

/**
 * ¿Esta compra da acceso ahora? Debe estar pagada, con el pago todavía aprobado (un reembolso total, un contracargo o un
 * reclamo la dejan sin efecto) y dentro de su periodo. Una devolución parcial no corta el acceso: el negocio decide.
 */
export function purchaseGrantsAccess(purchase: PurchaseForAccess, now: Date): boolean {
  return (
    purchase.status === "PAID" &&
    purchase.paymentStatus === "approved" &&
    purchase.refundedAmount < purchase.amount &&
    purchase.periodEnd !== null &&
    purchase.periodEnd.getTime() > now.getTime()
  );
}

/**
 * Acceso de un miembro a las páginas protegidas. Un miembro INVITADO entra mientras esté activo; uno que se hizo miembro
 * PAGANDO entra solo mientras tenga un periodo pagado vigente.
 */
export function memberHasAccess(member: { source: "INVITED" | "PURCHASED" }, purchases: PurchaseForAccess[], now: Date): boolean {
  if (member.source === "INVITED") return true;
  return purchases.some((purchase) => purchaseGrantsAccess(purchase, now));
}

/** Fin del acceso de pago: el mayor `periodEnd` de las compras que hoy dan acceso, o `null`. */
export function paidUntil(purchases: PurchaseForAccess[], now: Date): Date | null {
  const ends = purchases.filter((purchase) => purchaseGrantsAccess(purchase, now)).map((purchase) => purchase.periodEnd as Date);
  return ends.length === 0 ? null : new Date(Math.max(...ends.map((date) => date.getTime())));
}

/**
 * Inicio del periodo que se compra: si ya hay uno vigente, el nuevo empieza donde termina (los periodos se apilan y no se
 * pierde nada al renovar antes); si no, empieza ahora.
 */
export function nextPeriodStart(purchases: PurchaseForAccess[], now: Date): Date {
  return paidUntil(purchases, now) ?? now;
}
