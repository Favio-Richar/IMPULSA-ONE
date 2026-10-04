import { describe, expect, it } from "vitest";
import {
  AGENCY_IMPORT_MAX_CHARS,
  AGENCY_IMPORT_MAX_ROWS,
  agencyImportTemplateCsv,
  csvCell,
  detectDelimiter,
  importCsvBodySchema,
  importErrorReportCsv,
  parseCsv,
  prepareImport,
  readHeader,
  toCsv,
  validateImportRows,
} from "../index.js";

const ok = (text: string) => {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(result.message);
  return result;
};

describe("importar CSV — lectura", () => {
  it("lee comas, punto y coma y tabulación, y detecta el separador", () => {
    expect(ok("a,b,c\r\n1,2,3").delimiter).toBe(",");
    expect(ok("a;b;c\n1;2;3").delimiter).toBe(";");
    expect(ok("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
    expect(ok("a;b;c\n1;2;3").rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(detectDelimiter("solo una columna")).toBe(",");
    // Una coma DENTRO de comillas no cuenta como separador.
    expect(detectDelimiter('"a,b,c";d;e')).toBe(";");
  });

  it("respeta comillas: separadores, saltos de línea y comillas dobladas dentro de un campo", () => {
    const result = ok('nombre;nota\n"Café; del sol";"línea 1\nlínea 2"\n"Dice ""hola""";x');
    expect(result.rows).toEqual([["nombre", "nota"], ["Café; del sol", "línea 1\nlínea 2"], ['Dice "hola"', "x"]]);
  });

  it("acepta CRLF, LF y CR, ignora el BOM de Excel y las filas vacías", () => {
    expect(ok("\uFEFFa;b\r\n1;2\r\n\r\n3;4\r\n").rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(ok("a;b\r1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(ok("a;b\n;\n   ;  \n1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("conserva un campo vacío en medio y al final de la fila", () => {
    expect(ok("a;b;c\n1;;3\n4;5;").rows).toEqual([["a", "b", "c"], ["1", "", "3"], ["4", "5", ""]]);
  });

  it("una comilla sin cerrar es un error claro, no una fila truncada", () => {
    const result = parseCsv('a;b\n"abierta;x\n1;2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("comilla sin cerrar");
  });

  it("un archivo vacío no produce filas", () => {
    expect(ok("").rows).toEqual([]);
    expect(ok("\n\n  \n").rows).toEqual([]);
  });
});

describe("importar CSV — escritura sin inyección de fórmulas", () => {
  it("neutraliza todo lo que una hoja de cálculo ejecutaría como fórmula", () => {
    for (const dangerous of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1:A9)", '=HYPERLINK("http://x.test","clic")', "\t=1+1", "\r=1+1"]) {
      const cell = csvCell(dangerous);
      expect(cell.replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("no toca el texto normal ni lo que empieza con una letra o un número", () => {
    expect(csvCell("Café del Sol")).toBe("Café del Sol");
    expect(csvCell("5 estrellas")).toBe("5 estrellas");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("entrecomilla lo que trae el separador, comillas o saltos de línea, y dobla las comillas", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("a,b", ",")).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell("dos\nlíneas")).toBe('"dos\nlíneas"');
    // La neutralización y el entrecomillado se combinan sin romperse.
    expect(csvCell("=a;b")).toBe('"\'=a;b"');
  });

  it("lo que se escribe se vuelve a leer igual (ida y vuelta), incluido lo peligroso ya neutralizado", () => {
    const rows = [["nombre", "nota"], ["Café; del sol", "línea 1\nlínea 2"], ['Dice "hola"', "=1+1"]];
    const back = ok(toCsv(rows));
    expect(back.rows).toEqual([["nombre", "nota"], ["Café; del sol", "línea 1\nlínea 2"], ['Dice "hola"', "'=1+1"]]);
    expect(toCsv(rows).startsWith("\uFEFF")).toBe(true);
    expect(toCsv(rows)).toContain("\r\n");
  });

  it("la plantilla descargable se lee de vuelta y sus ejemplos son filas válidas", () => {
    const prepared = prepareImport(agencyImportTemplateCsv());
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.rows).toHaveLength(2);
      expect(prepared.rows.every((row) => row.ok)).toBe(true);
    }
  });
});

describe("importar CSV — encabezado", () => {
  it("encuentra las columnas sin importar acentos, mayúsculas ni orden, y acepta alias", () => {
    const header = readHeader(["Correo del Propietario", "NOMBRE", "Identificador", "¿Quién paga?"]);
    expect(header).toEqual({ ok: true, columns: { ownerEmail: 0, name: 1, slug: 2, billing: 3 } });
    expect(readHeader(["name", "slug", "email"])).toEqual({ ok: true, columns: { name: 0, slug: 1, ownerEmail: 2 } });
  });

  it("avisa qué columnas faltan, con los nombres de la plantilla", () => {
    const result = readHeader(["nombre", "telefono"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("identificador");
      expect(result.message).toContain("correo_del_propietario");
      expect(result.message).not.toContain("nombre,");
    }
  });
});

describe("importar CSV — validación fila por fila", () => {
  const header = { name: 0, slug: 1, ownerEmail: 2, billing: 3 };
  const validate = (...rows: string[][]) => validateImportRows(header, rows);

  it("una fila válida queda normalizada (correo en minúsculas, paga el cliente por defecto)", () => {
    expect(validate(["  Café del Sol ", "cafe-del-sol", " Dueno@CafeDelSol.CL "])).toEqual([
      { ok: true, rowNumber: 1, values: { name: "Café del Sol", slug: "cafe-del-sol", ownerEmail: "dueno@cafedelsol.cl", billingMode: "CLIENT_PAYS" } },
    ]);
  });

  it("entiende «cliente» y «agencia» (con o sin acentos y mayúsculas) y rechaza otra cosa", () => {
    const [a, b, c, d] = validate(["Uno", "uno-uno", "a@b.cl", "Agencia"], ["Dos", "dos-dos", "a@b.cl", "AGENCY_PAYS"], ["Tres", "tres-tres", "a@b.cl", "Cliente"], ["Cuatro", "cuatro-cuatro", "a@b.cl", "gratis"]);
    expect([a, b, c].map((row) => row?.ok && row.values.billingMode)).toEqual(["AGENCY_PAYS", "AGENCY_PAYS", "CLIENT_PAYS"]);
    expect(d).toMatchObject({ ok: false, code: "INVALID_BILLING" });
  });

  it("cada fila dice SU error y un error no frena a las demás", () => {
    const rows = validate(
      ["Bien", "bien-uno", "ok@ok.cl"],
      ["x", "nombre-corto", "ok@ok.cl"],
      ["Slug malo", "NO VALIDO", "ok@ok.cl"],
      ["Correo malo", "correo-malo", "no-es-un-correo"],
      ["Otra bien", "otra-bien", "ok@ok.cl"],
    );
    expect(rows.map((row) => (row.ok ? "ok" : row.code))).toEqual(["ok", "INVALID_NAME", "INVALID_SLUG", "INVALID_EMAIL", "ok"]);
    expect(rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4, 5]);
    const failed = rows[1]!;
    if (!failed.ok) {
      expect(failed.message).toContain("entre 2 y 120");
      expect(failed.raw).toEqual({ name: "x", slug: "nombre-corto", ownerEmail: "ok@ok.cl" });
    }
  });

  it("un identificador repetido en el archivo: solo la primera vale", () => {
    const rows = validate(["Uno", "mismo-id", "a@b.cl"], ["Dos", "mismo-id", "c@d.cl"], ["Tres", "otro-id", "e@f.cl"]);
    expect(rows.map((row) => (row.ok ? "ok" : row.code))).toEqual(["ok", "DUPLICATE_IN_FILE", "ok"]);
  });

  it("un identificador demasiado corto, con mayúsculas o con guiones al borde no pasa", () => {
    for (const slug of ["ab", "Mayus", "-borde", "borde-", "con espacio", "con_guion_bajo"]) {
      expect(validate(["Nombre", slug, "a@b.cl"])[0], slug).toMatchObject({ ok: false, code: "INVALID_SLUG" });
    }
  });

  it("lo que se guarda de un valor inválido está acotado, y una fila corta no revienta", () => {
    const long = "x".repeat(5000);
    const [row] = validate([long, "slug-valido", "a@b.cl"]);
    expect(row).toMatchObject({ ok: false, code: "INVALID_NAME" });
    if (row && !row.ok) expect(row.raw.name).toHaveLength(200);
    expect(validate(["Solo nombre"])[0]).toMatchObject({ ok: false, code: "INVALID_SLUG" });
  });

  it("un valor con forma de fórmula se trata como texto: no se evalúa nada, y se neutraliza al exportar", () => {
    const [row] = validate(["=HYPERLINK(\"x\")", "formula-uno", "a@b.cl"]);
    expect(row).toMatchObject({ ok: true });
    if (row?.ok) expect(csvCell(row.values.name)).toMatch(/^"?'=/);
  });
});

describe("importar CSV — del archivo al informe", () => {
  const file = (lines: string[]) => lines.join("\r\n");

  it("devuelve las filas validadas", () => {
    const prepared = prepareImport(file(["nombre;identificador;correo_del_propietario;quien_paga", "Uno;uno-uno;a@b.cl;cliente", "Dos;DOS;c@d.cl;"]));
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.rows.map((row) => (row.ok ? "ok" : row.code))).toEqual(["ok", "INVALID_SLUG"]);
  });

  it("rechaza el archivo entero (sin crear nada) si no sirve: vacío, sin encabezado, sin filas, demasiadas o con comillas abiertas", () => {
    const reasons = [
      prepareImport(""),
      prepareImport("\n\n"),
      prepareImport("telefono;direccion\n1;2"),
      prepareImport("nombre;identificador;correo_del_propietario"),
      prepareImport('nombre;identificador;correo_del_propietario\n"abierta;x;y'),
    ];
    for (const result of reasons) expect(result.ok).toBe(false);
    const many = ["nombre;identificador;correo_del_propietario", ...Array.from({ length: AGENCY_IMPORT_MAX_ROWS + 1 }, (_, index) => `C${index};c-${index};a${index}@b.cl`)];
    const tooMany = prepareImport(file(many));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toContain(`máximo es ${AGENCY_IMPORT_MAX_ROWS}`);
    const atLimit = prepareImport(file(many.slice(0, AGENCY_IMPORT_MAX_ROWS + 1)));
    expect(atLimit.ok).toBe(true);
  });

  it("el informe de errores es CSV seguro: la línea del archivo, sin fórmulas ejecutables", () => {
    const csv = importErrorReportCsv([
      { rowNumber: 2, rawName: "=CMD()", rawSlug: "NO VALIDO", rawOwnerEmail: "a@b.cl", errorMessage: "El identificador no sirve." },
      { rowNumber: 5, rawName: "Con; punto y coma", rawSlug: "x", rawOwnerEmail: "mal", errorMessage: null },
    ]);
    const back = ok(csv).rows;
    expect(back[0]).toEqual(["fila", "nombre", "identificador", "correo_del_propietario", "problema"]);
    // La fila de datos 2 es la línea 3 del archivo (hay un encabezado).
    expect(back[1]).toEqual(["3", "'=CMD()", "NO VALIDO", "a@b.cl", "El identificador no sirve."]);
    expect(back[2]).toEqual(["6", "Con; punto y coma", "x", "mal", ""]);
  });

  it("el cuerpo exige texto y lo acota", () => {
    expect(importCsvBodySchema.safeParse({ csv: "a;b" }).success).toBe(true);
    expect(importCsvBodySchema.safeParse({ csv: "" }).success).toBe(false);
    expect(importCsvBodySchema.safeParse({}).success).toBe(false);
    expect(importCsvBodySchema.safeParse({ csv: "x".repeat(AGENCY_IMPORT_MAX_CHARS) }).success).toBe(true);
    expect(importCsvBodySchema.safeParse({ csv: "x".repeat(AGENCY_IMPORT_MAX_CHARS + 1) }).success).toBe(false);
    expect(importCsvBodySchema.safeParse({ csv: "a;b", fileName: "x".repeat(201) }).success).toBe(false);
  });
});
