import { z } from "zod";
import { emailSchema, phoneSchema, safeUrlSchema, SOCIAL_NETWORKS, socialNetworkSchema } from "../blocks/primitives.js";
import { cleanPlainText } from "../moderation/abuse-report.js";

/**
 * Tarjeta digital del sitio (F10.4, ADR-029). Reglas compartidas por la API, `apps/web` y el panel; el servidor las vuelve a
 * aplicar siempre. Aquí también vive la construcción de la vCard: es un archivo que llega al teléfono de otra persona, así que
 * todo campo se escapa y ninguno puede inyectar líneas nuevas.
 */

export const CARD_NAME_MAX = 120;
export const CARD_SHORT_MAX = 100;
export const CARD_BIO_MAX = 300;
export const CARD_ADDRESS_MAX = 200;
export const CARD_SOCIALS_MAX = 8;

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().max(max, `Máximo ${max} caracteres.`));

const optionalText = (max: number) => text(max).nullable().optional();

export const digitalCardSchema = z
  .object({
    enabled: z.boolean(),
    fullName: text(CARD_NAME_MAX).pipe(z.string().min(1, "Escribe tu nombre.")),
    jobTitle: optionalText(CARD_SHORT_MAX),
    company: optionalText(CARD_SHORT_MAX),
    bio: optionalText(CARD_BIO_MAX),
    phone: phoneSchema.nullable().optional(),
    whatsapp: phoneSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    website: safeUrlSchema.nullable().optional(),
    address: optionalText(CARD_ADDRESS_MAX),
    photoUrl: safeUrlSchema.nullable().optional(),
    socials: z
      .array(z.object({ network: socialNetworkSchema, url: safeUrlSchema }).strict())
      .max(CARD_SOCIALS_MAX)
      .default([]),
  })
  .strict();
export type DigitalCardDto = z.infer<typeof digitalCardSchema>;

/** Campos que la vCard y los pases usan. Todo opcional salvo el nombre. */
export interface CardFields {
  fullName: string;
  jobTitle?: string | null;
  company?: string | null;
  bio?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  photoUrl?: string | null;
  socials?: ReadonlyArray<{ network: string; url: string }>;
}

// ───────────────────────────── vCard 3.0 ─────────────────────────────

// Construidas con códigos de carácter: un escape unicode en el fuente puede convertirse en un carácter real al editar el archivo.
const CONTROL_CHARS = new RegExp(`[${[...Array(32).keys()].filter((c) => c !== 9 && c !== 10 && c !== 13).map((c) => String.fromCharCode(c)).join("")}${String.fromCharCode(127)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** ¿Hay espacios, saltos o caracteres de control? Sin expresiones regulares: un valor así nunca entra a una línea de la vCard. */
function hasBlankOrControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 32 || code === 127 || code === 0xa0 || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/** Escapa un valor de texto de vCard (RFC 2426 §4): barra, punto y coma, coma y saltos de línea. Quita caracteres de control. */
export function escapeVCardText(value: string): string {
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Pliega una línea a 75 octetos (RFC 2426 §2.6): continúa con CRLF + un espacio, sin cortar un carácter UTF-8 por la mitad. */
export function foldVCardLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // la línea de continuación empieza con un espacio
    }
    current += char;
    bytes += size;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

/** `https://…` válido para un campo URI: sin espacios ni saltos de línea. */
function safeUri(value: string): string | null {
  const lower = value.toLowerCase();
  const isHttp = lower.startsWith("http://") || lower.startsWith("https://");
  return isHttp && value.length > 8 && !hasBlankOrControl(value) ? value : null;
}

/** Teléfono para `TEL`: solo `+` y dígitos. */
function safeTel(value: string): string | null {
  return /^\+[0-9]{6,15}$/.test(value) ? value : null;
}

/** Nombre y apellido para el campo `N`: el último término es el apellido. */
function splitName(fullName: string): { family: string; given: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { family: "", given: parts[0] ?? "" };
  return { family: parts[parts.length - 1]!, given: parts.slice(0, -1).join(" ") };
}

/**
 * vCard 3.0 de la tarjeta. `cardUrl` es la página pública de la tarjeta (`URL` principal y vínculo de vuelta). Cada valor se
 * escapa y se pliega; los que no son una URL o un teléfono válidos se omiten en vez de arriesgar la estructura del archivo.
 */
export function buildVCard(card: CardFields, options: { cardUrl: string; uid: string; now?: Date }): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const name = splitName(card.fullName);
  lines.push(`N:${escapeVCardText(name.family)};${escapeVCardText(name.given)};;;`);
  lines.push(`FN:${escapeVCardText(card.fullName)}`);
  if (card.company) lines.push(`ORG:${escapeVCardText(card.company)}`);
  if (card.jobTitle) lines.push(`TITLE:${escapeVCardText(card.jobTitle)}`);
  const phone = card.phone ? safeTel(card.phone) : null;
  if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${phone}`);
  const whatsapp = card.whatsapp ? safeTel(card.whatsapp) : null;
  if (whatsapp && whatsapp !== phone) lines.push(`TEL;TYPE=CELL:${whatsapp}`);
  if (card.email && !hasBlankOrControl(card.email)) lines.push(`EMAIL;TYPE=INTERNET,WORK:${card.email}`);
  const website = card.website ? safeUri(card.website) : null;
  if (website) lines.push(`URL;TYPE=WORK:${website}`);
  const cardUrl = safeUri(options.cardUrl);
  if (cardUrl) lines.push(`URL;TYPE=OTHER:${cardUrl}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCardText(card.address)};;;;`);
  if (card.bio) lines.push(`NOTE:${escapeVCardText(card.bio)}`);
  const photo = card.photoUrl ? safeUri(card.photoUrl) : null;
  if (photo) lines.push(`PHOTO;VALUE=uri:${photo}`);
  for (const social of card.socials ?? []) {
    const url = safeUri(social.url);
    const network = (SOCIAL_NETWORKS as readonly string[]).includes(social.network) ? social.network : null;
    if (url && network) lines.push(`X-SOCIALPROFILE;TYPE=${network}:${url}`);
  }
  lines.push(`UID:urn:uuid:${options.uid.replace(/[^0-9a-fA-F-]/g, "")}`);
  lines.push(`REV:${(options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  lines.push("END:VCARD");
  return `${lines.map(foldVCardLine).join("\r\n")}\r\n`;
}

/** Nombre de archivo seguro para la descarga (sin tildes, espacios ni separadores de ruta). */
export function vCardFileName(fullName: string): string {
  const base = fullName
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "contacto"}.vcf`;
}
