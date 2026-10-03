import { isSafeAssetUrl } from "./common.js";
import { DEFAULT_PLATFORM_BRANDING } from "./index.js";
import { safeBrandColor, type ResolvedBrand } from "./resolve.js";

/** Lo mínimo que necesita un correo para recibir la marca (compatible con `EmailMessage` de `@impulza/auth`). */
export interface BrandableEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  from?: { name: string; email?: string | null };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function textToHtml(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px 0;line-height:1.5">${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Correo que **una organización** envía a sus propios clientes (confirmaciones de reserva, pedidos,
 * newsletter, secuencias, campañas): firma con el nombre de su marca y, en la versión HTML, encabezado
 * con su logo y color más un pie con su contacto (F9.2 criterio 4b).
 *
 * - `from.name` es el de la marca; `from.email` **no se toca**: un remitente propio solo se usa con un dominio
 *   verificado (ADR-028 §5, F9.7). El adaptador de correo decide el remitente real.
 * - La parte de texto no cambia. Si el correo ya traía HTML (campañas, secuencias) se envuelve; si no, se
 *   genera a partir del texto, escapado.
 * - Todo valor guardado se valida al renderizar: logo con `isSafeAssetUrl`, color hexadecimal; el resto, escapado.
 */
export function brandEmail<T extends BrandableEmail>(
  message: T,
  brand: ResolvedBrand,
): T & { from: { name: string; email: string | null }; html: string } {
  const name = escapeHtml(brand.displayName);
  const color = safeBrandColor(brand.primaryColor, DEFAULT_PLATFORM_BRANDING.primaryColor);
  const logo = brand.logoLightUrl && isSafeAssetUrl(brand.logoLightUrl) ? brand.logoLightUrl : null;
  const body = message.html ?? textToHtml(message.text);

  const header = `<div style="padding:16px 0;border-bottom:3px solid ${color}">${
    logo ? `<img src="${escapeHtml(logo)}" alt="${name}" style="max-height:40px;max-width:200px;vertical-align:middle;margin-right:10px">` : ""
  }<span style="font-size:18px;font-weight:bold;color:#1f2933;vertical-align:middle">${name}</span></div>`;

  const contact = brand.contactEmail ? ` · ${escapeHtml(brand.contactEmail)}` : "";
  const footer = `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e4e7eb;font-size:12px;color:#52606d">Enviado por ${name}${contact}</div>`;

  return {
    ...message,
    from: { name: brand.senderName, email: brand.senderEmail },
    html: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2933">${header}<div style="padding:16px 0">${body}</div>${footer}</div>`,
  };
}
