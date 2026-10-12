import { describe, expect, it } from "vitest";
import { buildVCard, digitalCardSchema, escapeVCardText, foldVCardLine, vCardFileName } from "./index.js";

const base = { fullName: "Ana María Pérez", jobTitle: "Fotógrafa", company: "Estudio Luz", phone: "+56912345678", email: "ana@estudioluz.cl", website: "https://estudioluz.cl" };
const opts = { cardUrl: "https://impulza.cl/estudio-luz/t", uid: "11111111-2222-3333-4444-555555555555", now: new Date("2026-10-12T12:00:00Z") };

describe("vCard de la tarjeta digital (F10.4)", () => {
  it("arma una vCard 3.0 válida con CRLF y los campos esperados", () => {
    const vcard = buildVCard(base, opts);
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard).toContain("FN:Ana María Pérez\r\n");
    expect(vcard).toContain("N:Pérez;Ana María;;;\r\n");
    expect(vcard).toContain("TEL;TYPE=CELL,VOICE:+56912345678\r\n");
    expect(vcard).toContain("EMAIL;TYPE=INTERNET,WORK:ana@estudioluz.cl\r\n");
    expect(vcard).toContain("URL;TYPE=OTHER:https://impulza.cl/estudio-luz/t\r\n");
    expect(vcard).toContain("UID:urn:uuid:11111111-2222-3333-4444-555555555555\r\n");
    expect(vcard).toContain("REV:20261012T120000Z\r\n");
  });

  it("un valor hostil no puede inyectar líneas ni propiedades nuevas", () => {
    const hostile = buildVCard(
      {
        fullName: "Eva\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Falso",
        jobTitle: "Jefa;\nTEL:+1000",
        company: `A, B${String.fromCharCode(92)}C`,
        bio: "línea 1\nline 2\r\nX-EVIL:1",
        address: "Calle 1; Piso 2\nCiudad",
        website: "javascript:alert(1)",
        photoUrl: "https://ok.example/foto.png\r\nX-EVIL:1",
        email: "x@y.cl\r\nBCC:z@z.cl",
      },
      opts,
    );
    const lines = vcardLines(hostile);
    // Una sola tarjeta, y ninguna línea suelta con propiedades inventadas.
    expect(lines.filter((line) => line === "BEGIN:VCARD")).toHaveLength(1);
    expect(lines.filter((line) => line === "END:VCARD")).toHaveLength(1);
    expect(lines.some((line) => /^(X-EVIL|BCC|TEL:\+1000|FN:Falso)/.test(line))).toBe(false);
    expect(hostile).not.toContain("javascript:");
    // Los saltos y el punto y coma de los valores quedan escritos como texto escapado (barra + n, barra + punto y coma).
    const bs = String.fromCharCode(92);
    expect(hostile).toContain(`${bs};`);
    expect(hostile).toContain(`${bs}n`);
  });

  it("escapa barra, punto y coma, coma y saltos; descarta caracteres de control", () => {
    // Sin escapes en el fuente: se arman con códigos de carácter.
    const bs = String.fromCharCode(92);
    const nl = String.fromCharCode(10);
    expect(escapeVCardText(`a${bs}b;c,d${nl}e`)).toBe(`a${bs}${bs}b${bs};c${bs},d${bs}ne`);
    expect(escapeVCardText(`a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`)).toBe("abc");
  });

  it("pliega a 75 octetos sin partir un carácter multibyte", () => {
    const long = `NOTE:${"ñ".repeat(120)}`;
    const folded = foldVCardLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    // Al desplegar se recupera el original.
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join("")).toBe(long);
  });

  it("omite teléfonos y URLs inválidos en lugar de arriesgar el archivo", () => {
    const vcard = buildVCard({ fullName: "Luis", phone: "56 9 1234", website: "ftp://x", socials: [{ network: "instagram", url: "https://instagram.com/luis" }, { network: "otra", url: "https://x.cl" }] }, opts);
    expect(vcard).not.toContain("TEL");
    expect(vcard).not.toContain("ftp://");
    expect(vcard).toContain("X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/luis");
    expect(vcard).not.toContain("TYPE=otra");
  });

  it("el nombre de archivo es seguro", () => {
    expect(vCardFileName("Ana María Pérez")).toBe("ana-maria-perez.vcf");
    expect(vCardFileName("../../etc/passwd")).toBe("etc-passwd.vcf");
    expect(vCardFileName("???")).toBe("contacto.vcf");
  });
});

describe("datos de la tarjeta (F10.4)", () => {
  it("exige nombre, valida teléfono internacional y URL https, y limpia el texto", () => {
    expect(digitalCardSchema.safeParse({ enabled: true, fullName: "  " }).success).toBe(false);
    expect(digitalCardSchema.safeParse({ enabled: true, fullName: "Ana", phone: "912345678" }).success).toBe(false);
    expect(digitalCardSchema.safeParse({ enabled: true, fullName: "Ana", website: "javascript:alert(1)" }).success).toBe(false);
    // Texto plano: los caracteres de control se quitan y los espacios se normalizan (las etiquetas quedan como texto inerte).
    const noisy = `  Ana${String.fromCharCode(7)} Pérez  `;
    const ok = digitalCardSchema.parse({ enabled: true, fullName: noisy, phone: "+56912345678", socials: [] });
    expect(ok.fullName).toBe("Ana Pérez");
    expect(digitalCardSchema.safeParse({ enabled: true, fullName: "Ana", extra: 1 }).success).toBe(false);
  });
});

function vcardLines(vcard: string): string[] {
  // Despliega las líneas plegadas y separa por CRLF.
  return vcard.replace(/\r\n /g, "").split("\r\n").filter((line) => line.length > 0);
}
