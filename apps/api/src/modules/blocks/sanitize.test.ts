import { describe, expect, it } from "vitest";
import { sanitizeBlockConfig, sanitizeRichText } from "./sanitize.js";

// Pruebas unitarias del sanitizador (F2.4). No necesitan base de datos: lo que se verifica es que
// nada ejecutable sobreviva a la lista blanca, y que la sanitización llegue a los campos anidados.

describe("sanitizeRichText", () => {
  it("elimina scripts y su contenido", () => {
    expect(sanitizeRichText("<p>hola</p><script>alert(1)</script>")).toBe("<p>hola</p>");
  });

  it("elimina atributos de evento en línea", () => {
    const result = sanitizeRichText('<p onclick="alert(1)" onmouseover="x()">texto</p>');
    expect(result).toBe("<p>texto</p>");
    expect(result).not.toContain("onclick");
  });

  it("elimina iframes, estilos y formularios", () => {
    for (const payload of [
      '<iframe src="https://evil.example.com"></iframe>',
      "<style>body{display:none}</style>",
      '<form action="https://evil.example.com"><input name="x"></form>',
      '<object data="x"></object>',
      '<embed src="x">',
    ]) {
      expect(sanitizeRichText(payload)).not.toMatch(/<(iframe|style|form|object|embed|input)/);
    }
  });

  it("neutraliza javascript: y data: dentro de un href", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).not.toContain("javascript:");
    expect(sanitizeRichText('<a href="data:text/html,<script>x</script>">click</a>')).not.toContain("data:");
  });

  it("conserva el formato legítimo que produce el editor", () => {
    const input = "<p><strong>Hola</strong> <em>mundo</em></p><ul><li>uno</li></ul><h2>Título</h2>";
    expect(sanitizeRichText(input)).toBe(input);
  });

  it("fuerza rel=noopener en los enlaces, aunque el editor no lo ponga", () => {
    // Sin noopener, un enlace con target=_blank deja que el destino manipule la ventana original.
    const result = sanitizeRichText('<a href="https://ejemplo.cl" target="_blank">ir</a>');
    expect(result).toContain('rel="noopener noreferrer nofollow"');
  });

  it("no deja pasar un script escondido tras etiquetas mal formadas", () => {
    // Clásico intento de evadir un filtro ingenuo que borra "<script>" una sola vez: al quitarlo,
    // los restos se recomponen en una etiqueta válida. Lo que importa acá no es que desaparezca
    // el texto "alert(1)" —puede sobrevivir como texto escapado, y eso es inofensivo— sino que no
    // quede ninguna etiqueta ejecutable ni un `<` sin escapar que el navegador pueda reinterpretar.
    const result = sanitizeRichText("<p>a</p><scr<script>ipt>alert(1)</scr</script>ipt>");

    expect(result.toLowerCase()).not.toContain("<script");
    // Lo que queda del intento es texto escapado (`&gt;`), no marcado: el navegador lo muestra.
    expect(result).toBe("<p>a</p>ipt&gt;alert(1)ipt&gt;");
  });
});

describe("sanitizeBlockConfig", () => {
  it("sanitiza el campo declarado de un bloque de texto", () => {
    const result = sanitizeBlockConfig("text", {
      html: "<p>ok</p><script>alert(1)</script>",
      alignment: "left",
    });

    expect(result).toEqual({ html: "<p>ok</p>", alignment: "left" });
  });

  it("sanitiza campos anidados dentro de listas (faq.items[].answer)", () => {
    const result = sanitizeBlockConfig("faq", {
      items: [
        { question: "¿Cómo?", answer: "<p>Así</p><script>alert(1)</script>" },
        { question: "¿Y esto?", answer: '<p onclick="alert(2)">Así también</p>' },
      ],
    }) as { items: Array<{ question: string; answer: string }> };

    expect(result.items[0]?.answer).toBe("<p>Así</p>");
    expect(result.items[1]?.answer).toBe("<p>Así también</p>");
    // El texto plano de al lado no se toca.
    expect(result.items[0]?.question).toBe("¿Cómo?");
  });

  it("no toca los bloques que no declaran texto enriquecido", () => {
    const config = { style: "line", size: "md" };
    expect(sanitizeBlockConfig("divider", config)).toEqual(config);
  });

  it("no muta el objeto original que recibió", () => {
    const original = { html: "<script>alert(1)</script>", alignment: "left" };
    sanitizeBlockConfig("text", original);
    expect(original.html).toBe("<script>alert(1)</script>");
  });

  it("un tipo desconocido se devuelve tal cual, sin reventar", () => {
    const config = { lo: "que sea" };
    expect(sanitizeBlockConfig("tipo_inexistente", config)).toEqual(config);
  });
});
