/**
 * Saneador de SVG por **lista de permitidos** (F9.1, ADR-028 §4).
 *
 * No busca patrones prohibidos (esa estrategia se salta con entidades codificadas, `<animate>`,
 * `<set>`, etc.): descompone el documento en etiquetas y atributos, descarta todo lo que no esté en
 * la lista y **reconstruye** el SVG con valores escapados. Lo que no se puede expresar con la lista
 * se rechaza con un motivo claro. Es deliberadamente estricto: un logo exportado con atributos de
 * presentación (`fill`, `stroke`, `d`…) pasa; uno que dependa de `<style>`, filtros o scripts no.
 */

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "symbol", "use", "text", "tspan",
]);

const TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc"]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "class", "xmlns", "xmlns:xlink", "viewBox", "width", "height", "preserveAspectRatio", "version",
  "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "fx", "fy", "d", "points", "transform",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "opacity", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod",
  "clipPathUnits", "clip-path", "mask", "maskUnits", "maskContentUnits", "href", "xlink:href",
  "text-anchor", "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
  "dominant-baseline", "dx", "dy", "role", "aria-label", "aria-hidden", "focusable",
]);

const XMLNS_VALUES: Record<string, string> = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
};

const MAX_ELEMENTS = 2000;
const MAX_DEPTH = 32;
const MAX_TEXT_LENGTH = 200;

export type SvgSanitizeResult = { ok: true; sanitized: string } | { ok: false; error: string };

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `null` si el valor es aceptable; si no, el motivo del rechazo. */
function attributeValueProblem(name: string, value: string): string | null {
  if (name in XMLNS_VALUES) {
    return value === XMLNS_VALUES[name] ? null : "El SVG declara un espacio de nombres no permitido.";
  }
  // Entidades (`&#106;avascript:`), etiquetas, barras invertidas y caracteres de control: nada de eso
  // tiene sentido en un logo y es la vía habitual para esconder un protocolo ejecutable.
  if (/[&<>\\]/.test(value) || [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return "El SVG contiene entidades o caracteres no permitidos en un atributo.";
  }
  if (/(?:javascript|vbscript|data)\s*:/i.test(value)) {
    return "El SVG contiene pseudoprotocolos ejecutables no permitidos.";
  }
  if (name === "href" || name === "xlink:href") {
    return /^#[A-Za-z0-9_.-]+$/.test(value) ? null : "El SVG contiene enlaces a recursos externos no permitidos.";
  }
  for (const match of value.matchAll(/url\(([^)]*)\)/gi)) {
    const target = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (!/^#[A-Za-z0-9_.-]+$/.test(target)) {
      return "El SVG contiene referencias url() a recursos externos no permitidas.";
    }
  }
  return null;
}

export function sanitizeSvg(source: string): SvgSanitizeResult {
  let input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const prolog = /^\s*<\?xml[^?]*\?>/i.exec(input);
  if (prolog) input = input.slice(prolog[0].length);

  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(input)) {
    return { ok: false, error: "El SVG contiene definiciones de entidades o DOCTYPE no permitidas." };
  }
  if (/<\?/.test(input)) {
    return { ok: false, error: "El SVG contiene instrucciones de procesamiento no permitidas." };
  }

  const out: string[] = [];
  const stack: string[] = [];
  let elements = 0;
  let rootClosed = false;
  let index = 0;

  while (index < input.length) {
    if (input.startsWith("<!--", index)) {
      const end = input.indexOf("-->", index + 4);
      if (end === -1) return { ok: false, error: "El SVG tiene un comentario sin cerrar." };
      index = end + 3;
      continue;
    }

    if (input[index] !== "<") {
      const next = input.indexOf("<", index);
      const text = input.slice(index, next === -1 ? input.length : next);
      index = next === -1 ? input.length : next;
      if (text.trim() === "") continue;
      const parent = stack[stack.length - 1];
      if (!parent || !TEXT_ELEMENTS.has(parent)) {
        return { ok: false, error: "El SVG contiene texto fuera de un elemento de texto." };
      }
      if (text.includes("&")) return { ok: false, error: "El SVG contiene entidades no permitidas." };
      if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: "El SVG contiene un texto demasiado largo." };
      out.push(escapeText(text));
      continue;
    }

    if (input.startsWith("</", index)) {
      const end = input.indexOf(">", index);
      if (end === -1) return { ok: false, error: "El SVG tiene una etiqueta de cierre sin terminar." };
      const name = input.slice(index + 2, end).trim();
      if (stack.pop() !== name) return { ok: false, error: "El SVG está mal formado (etiquetas sin cerrar o desordenadas)." };
      out.push(`</${name}>`);
      if (stack.length === 0) rootClosed = true;
      index = end + 1;
      continue;
    }

    // Etiqueta de apertura.
    const nameMatch = /^<([A-Za-z][A-Za-z0-9]*)/.exec(input.slice(index));
    if (!nameMatch) return { ok: false, error: "El SVG contiene una etiqueta no válida." };
    const name = nameMatch[1]!;
    if (!ALLOWED_ELEMENTS.has(name)) {
      if (name === "script") return { ok: false, error: "El SVG contiene etiquetas <script> no permitidas." };
      if (name === "foreignObject") return { ok: false, error: "El SVG contiene elementos foreignObject no permitidos." };
      return { ok: false, error: `El SVG usa el elemento <${name}>, que no está permitido en un logo.` };
    }
    if (rootClosed) return { ok: false, error: "El SVG tiene más de un elemento raíz." };
    if (stack.length === 0 && name !== "svg") return { ok: false, error: "El archivo no es un documento SVG válido." };
    elements += 1;
    if (elements > MAX_ELEMENTS) return { ok: false, error: "El SVG es demasiado complejo para un logo." };

    let cursor = index + nameMatch[0].length;
    const attributes: string[] = [];
    const seen = new Set<string>();
    let selfClosing = false;

    for (;;) {
      while (cursor < input.length && /\s/.test(input[cursor]!)) cursor += 1;
      if (cursor >= input.length) return { ok: false, error: "El SVG tiene una etiqueta sin terminar." };
      if (input.startsWith("/>", cursor)) {
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (input[cursor] === ">") {
        cursor += 1;
        break;
      }
      const attribute = /^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(input.slice(cursor));
      if (!attribute) return { ok: false, error: "El SVG contiene un atributo mal formado." };
      const attributeName = attribute[1]!;
      const value = attribute[2] ?? attribute[3] ?? "";
      cursor += attribute[0].length;

      if (/^on/i.test(attributeName)) {
        return { ok: false, error: "El SVG contiene manejadores de eventos inline (on...) no permitidos." };
      }
      if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
        return { ok: false, error: `El SVG usa el atributo «${attributeName}», que no está permitido en un logo.` };
      }
      if (seen.has(attributeName)) return { ok: false, error: "El SVG repite un atributo." };
      seen.add(attributeName);
      const problem = attributeValueProblem(attributeName, value);
      if (problem) return { ok: false, error: problem };
      attributes.push(` ${attributeName}="${escapeAttribute(value)}"`);
    }

    out.push(`<${name}${attributes.join("")}${selfClosing ? "/>" : ">"}`);
    if (selfClosing) {
      if (stack.length === 0) rootClosed = true;
    } else {
      stack.push(name);
      if (stack.length > MAX_DEPTH) return { ok: false, error: "El SVG tiene demasiados niveles de anidamiento." };
    }
    index = cursor;
  }

  if (stack.length > 0) return { ok: false, error: "El SVG está mal formado (etiquetas sin cerrar)." };
  if (!rootClosed) return { ok: false, error: "El archivo no es un documento SVG válido." };
  return { ok: true, sanitized: out.join("") };
}
