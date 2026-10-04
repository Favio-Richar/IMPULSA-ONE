import { z } from "zod";
import { slugSchema } from "../slug.js";
import type { AgencyBillingModeValue } from "./index.js";

// Importar clientes por CSV (F9.5d, ADR-028 §2). Reglas puras: leer el archivo, validar cada fila y escribir un CSV de salida sin
// riesgo de «inyección de fórmulas». Nada de esto evalúa nada: un CSV es texto, y cada celda es un dato.

/** Filas de datos por archivo (sin contar el encabezado). El tope protege a la API y al plan; para más, se sube en varios archivos. */
export const AGENCY_IMPORT_MAX_ROWS = 200;
/**
 * Tamaño máximo del texto del archivo, en caracteres. 200 filas reales (~70 caracteres cada una) ocupan ~14 000: esto es muy holgado. Se
 * mantiene por debajo de lo que cabe en el cuerpo JSON por defecto de la API (100 kB, con acentos a 2 bytes), para que un archivo
 * demasiado grande reciba siempre el mensaje claro de este límite y no un 413 genérico.
 */
export const AGENCY_IMPORT_MAX_CHARS = 45_000;
/** Cuánto se guarda de un valor inválido en el informe: lo justo para reconocer la fila, no un volcado del archivo. */
const RAW_VALUE_LIMIT = 200;

/** Encabezado de la plantilla. El punto y coma es el separador que Excel usa en español; el lector acepta también coma y tabulación. */
export const AGENCY_IMPORT_TEMPLATE_HEADER = ["nombre", "identificador", "correo_del_propietario", "quien_paga"] as const;
export const AGENCY_IMPORT_TEMPLATE_EXAMPLES: ReadonlyArray<readonly string[]> = [
  ["Café del Sol", "cafe-del-sol", "dueno@cafedelsol.cl", "cliente"],
  ["Taller Boreal", "taller-boreal", "contacto@tallerboreal.cl", "agencia"],
];

// ---- lectura ---------------------------------------------------------------------------------------------------------

export type CsvParseResult = { ok: true; delimiter: string; rows: string[][] } | { ok: false; message: string };

/** El separador es el que más aparece fuera de comillas en la primera línea (coma, punto y coma o tabulación). */
export function detectDelimiter(text: string): string {
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  const best = (Object.entries(counts) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/**
 * Lector de CSV (RFC 4180): campos entre comillas con comas, saltos de línea y comillas dobladas adentro; líneas terminadas en
 * CRLF, LF o CR; BOM al inicio (lo agrega Excel). Las filas totalmente vacías se ignoran. Una comilla sin cerrar es un error
 * claro, nunca una fila silenciosamente truncada.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
    quoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "" && !quoted) {
      inQuotes = true;
      quoted = true;
    } else if (char === delimiter) endField();
    else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRow();
    } else if (char === "\n") endRow();
    else field += char;
  }
  if (inQuotes) return { ok: false, message: "El archivo tiene una comilla sin cerrar. Revisa que cada texto entre comillas termine con comillas." };
  if (field !== "" || row.length > 0) endRow();
  return { ok: true, delimiter, rows };
}

// ---- escritura -------------------------------------------------------------------------------------------------------

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Una celda lista para escribir en un CSV que alguien abrirá en una hoja de cálculo. Un valor que empieza con `=`, `+`, `-`, `@`,
 * tabulación o retorno se ejecutaría como fórmula (inyección de fórmulas, OWASP): se le antepone una comilla simple para que sea
 * texto. Después se entrecomilla si hace falta. Se aplica a TODO lo que sale en un CSV, venga de quien venga.
 */
export function csvCell(value: string | number | null | undefined, delimiter = ";"): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Texto CSV con BOM (para que Excel reconozca los acentos) y saltos CRLF. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>, delimiter = ";"): string {
  return `\uFEFF${rows.map((line) => line.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}

export function agencyImportTemplateCsv(): string {
  return toCsv([AGENCY_IMPORT_TEMPLATE_HEADER, ...AGENCY_IMPORT_TEMPLATE_EXAMPLES]);
}

// ---- encabezado ----------------------------------------------------------------------------------------------------

export type ImportColumn = "name" | "slug" | "ownerEmail" | "billing";

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const COLUMN_ALIASES: Record<ImportColumn, readonly string[]> = {
  name: ["nombre", "nombre_del_cliente", "nombre_del_negocio", "name"],
  slug: ["identificador", "identificador_interno", "slug", "id"],
  ownerEmail: ["correo_del_propietario", "correo_propietario", "correo", "email", "email_del_propietario", "owner_email"],
  billing: ["quien_paga", "paga", "facturacion", "billing", "billing_mode"],
};
const REQUIRED_COLUMNS: readonly ImportColumn[] = ["name", "slug", "ownerEmail"];
const COLUMN_LABEL: Record<ImportColumn, string> = { name: "nombre", slug: "identificador", ownerEmail: "correo_del_propietario", billing: "quien_paga" };

export type HeaderResult = { ok: true; columns: Partial<Record<ImportColumn, number>> } | { ok: false; message: string };

/** Ubica cada columna por su nombre (sin importar acentos, mayúsculas ni el orden). Faltan columnas → mensaje claro, no un error por fila. */
export function readHeader(header: readonly string[]): HeaderResult {
  const normalized = header.map(normalizeHeader);
  const columns: Partial<Record<ImportColumn, number>> = {};
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES) as Array<[ImportColumn, readonly string[]]>) {
    const index = normalized.findIndex((name) => aliases.includes(name));
    if (index !== -1) columns[column] = index;
  }
  const missing = REQUIRED_COLUMNS.filter((column) => columns[column] === undefined);
  if (missing.length > 0) {
    return { ok: false, message: `Faltan columnas en el encabezado: ${missing.map((column) => COLUMN_LABEL[column]).join(", ")}. Descarga la plantilla para ver el formato.` };
  }
  return { ok: true, columns };
}

// ---- filas ---------------------------------------------------------------------------------------------------------

export const AGENCY_IMPORT_ERROR_CODES = ["INVALID_NAME", "INVALID_SLUG", "INVALID_EMAIL", "INVALID_BILLING", "DUPLICATE_IN_FILE", "SLUG_TAKEN", "NO_QUOTA", "FAILED"] as const;
export type AgencyImportErrorCode = (typeof AGENCY_IMPORT_ERROR_CODES)[number];

export const AGENCY_IMPORT_ERROR_TEXT: Record<AgencyImportErrorCode, string> = {
  INVALID_NAME: "El nombre debe tener entre 2 y 120 caracteres.",
  INVALID_SLUG: "El identificador debe tener de 3 a 63 caracteres: minúsculas, números y guiones (sin empezar ni terminar en guión).",
  INVALID_EMAIL: "El correo del propietario no es válido.",
  INVALID_BILLING: "«Quién paga» debe ser «cliente» o «agencia» (o quedar vacío: paga el cliente).",
  DUPLICATE_IN_FILE: "Este identificador ya aparece antes en el archivo.",
  SLUG_TAKEN: "Ese identificador ya está en uso por otro negocio (o por un cliente tuyo con otro correo de propietario).",
  NO_QUOTA: "Tu plan no tiene más cupo de clientes: esta fila no se importó.",
  FAILED: "No pudimos crear este cliente. Inténtalo de nuevo con un archivo nuevo.",
};

export interface ImportRowValues {
  name: string;
  slug: string;
  ownerEmail: string;
  billingMode: AgencyBillingModeValue;
}

export type ImportRowResult =
  | { ok: true; rowNumber: number; values: ImportRowValues }
  | { ok: false; rowNumber: number; code: AgencyImportErrorCode; message: string; raw: { name: string; slug: string; ownerEmail: string } };

const nameSchema = z.string().trim().min(2).max(120);
const emailSchema = z.string().trim().toLowerCase().email().max(254);

const BILLING_BY_TEXT: Record<string, AgencyBillingModeValue> = {
  "": "CLIENT_PAYS",
  cliente: "CLIENT_PAYS",
  client_pays: "CLIENT_PAYS",
  agencia: "AGENCY_PAYS",
  agency_pays: "AGENCY_PAYS",
};

const clip = (value: string): string => value.trim().slice(0, RAW_VALUE_LIMIT);

/**
 * Valida cada fila **en el servidor** (nunca se confía en lo que muestre el navegador). Un error no frena a las demás: cada fila dice qué
 * le pasa. `rowNumber` es la posición entre las filas de datos (1 = la primera después del encabezado); en el archivo es la línea `rowNumber + 1`.
 */
export function validateImportRows(header: Partial<Record<ImportColumn, number>>, dataRows: readonly (readonly string[])[]): ImportRowResult[] {
  const seen = new Set<string>();
  return dataRows.map((cells, index): ImportRowResult => {
    const rowNumber = index + 1;
    const cell = (column: ImportColumn): string => (header[column] === undefined ? "" : (cells[header[column]!] ?? ""));
    const raw = { name: clip(cell("name")), slug: clip(cell("slug")), ownerEmail: clip(cell("ownerEmail")) };
    const fail = (code: AgencyImportErrorCode): ImportRowResult => ({ ok: false, rowNumber, code, message: AGENCY_IMPORT_ERROR_TEXT[code], raw });

    const name = nameSchema.safeParse(cell("name"));
    if (!name.success) return fail("INVALID_NAME");
    const slug = slugSchema.safeParse(cell("slug"));
    if (!slug.success) return fail("INVALID_SLUG");
    const ownerEmail = emailSchema.safeParse(cell("ownerEmail"));
    if (!ownerEmail.success) return fail("INVALID_EMAIL");
    const billing = BILLING_BY_TEXT[normalizeHeader(cell("billing"))];
    if (billing === undefined) return fail("INVALID_BILLING");
    if (seen.has(slug.data)) return fail("DUPLICATE_IN_FILE");
    seen.add(slug.data);
    return { ok: true, rowNumber, values: { name: name.data, slug: slug.data, ownerEmail: ownerEmail.data, billingMode: billing } };
  });
}

export const importCsvBodySchema = z.object({
  csv: z.string().min(1, "El archivo está vacío.").max(AGENCY_IMPORT_MAX_CHARS, `El archivo es demasiado grande (máximo ${AGENCY_IMPORT_MAX_CHARS.toLocaleString("es-CL")} caracteres).`),
  fileName: z.string().trim().max(200).optional(),
});
export type ImportCsvBody = z.infer<typeof importCsvBodySchema>;

export type PreparedImport = { ok: true; rows: ImportRowResult[] } | { ok: false; message: string };

/** Del texto del archivo a las filas ya validadas, o un mensaje claro si el archivo no sirve (vacío, sin encabezado, demasiadas filas…). */
export function prepareImport(csv: string): PreparedImport {
  const parsed = parseCsv(csv);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const [header, ...data] = parsed.rows;
  if (!header) return { ok: false, message: "El archivo no tiene datos. Descarga la plantilla para ver el formato." };
  const columns = readHeader(header);
  if (!columns.ok) return { ok: false, message: columns.message };
  if (data.length === 0) return { ok: false, message: "El archivo tiene el encabezado pero ninguna fila de clientes." };
  if (data.length > AGENCY_IMPORT_MAX_ROWS) {
    return { ok: false, message: `El archivo tiene ${data.length} filas y el máximo es ${AGENCY_IMPORT_MAX_ROWS}. Divídelo en varios archivos.` };
  }
  return { ok: true, rows: validateImportRows(columns.columns, data) };
}

/** Informe de las filas con problemas, como CSV seguro: se puede corregir y volver a subir. */
export function importErrorReportCsv(rows: ReadonlyArray<{ rowNumber: number; rawName: string; rawSlug: string; rawOwnerEmail: string; errorMessage: string | null }>): string {
  return toCsv([
    ["fila", "nombre", "identificador", "correo_del_propietario", "problema"],
    ...rows.map((row) => [row.rowNumber + 1, row.rawName, row.rawSlug, row.rawOwnerEmail, row.errorMessage ?? ""]),
  ]);
}

export const agencyImportDetailQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** `true` = solo las filas con problema (para corregirlas). */
  onlyErrors: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type AgencyImportDetailQuery = z.infer<typeof agencyImportDetailQuerySchema>;
