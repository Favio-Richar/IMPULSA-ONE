import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "./sanitize";

// Defensa en profundidad (F2.7): apps/api ya sanea al guardar, esto prueba que la segunda pasada
// en el render público, por su cuenta, también neutraliza cualquier intento de ejecución.

describe("sanitizeRichText (defensa en profundidad, F2.7)", () => {
  it("elimina scripts y su contenido", () => {
    expect(sanitizeRichText("<p>hola</p><script>alert(1)</script>")).toBe("<p>hola</p>");
  });

  it("elimina atributos de evento en línea", () => {
    const result = sanitizeRichText('<p onclick="alert(1)">texto</p>');
    expect(result).toBe("<p>texto</p>");
    expect(result).not.toContain("onclick");
  });

  it("elimina iframes, estilos y formularios", () => {
    for (const payload of [
      '<iframe src="https://evil.example.com"></iframe>',
      "<style>body{display:none}</style>",
      '<form action="https://evil.example.com"><input name="x"></form>',
    ]) {
      expect(sanitizeRichText(payload)).not.toMatch(/<(iframe|style|form|input)/);
    }
  });

  it("neutraliza javascript: y data: dentro de un href", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">clic</a>')).not.toContain("javascript:");
    expect(sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">clic</a>')).not.toContain(
      "data:",
    );
  });

  it("fuerza rel=noopener noreferrer nofollow en todo enlace, aunque el editor no lo haya puesto", () => {
    expect(sanitizeRichText('<a href="https://ejemplo.cl" target="_blank">visitar</a>')).toContain(
      'rel="noopener noreferrer nofollow"',
    );
  });

  it("conserva las etiquetas de la lista blanca sin alterarlas", () => {
    const html = "<p>Texto con <strong>énfasis</strong> y una <a href=\"https://ejemplo.cl\">liga</a>.</p>";
    const result = sanitizeRichText(html);
    expect(result).toContain("<strong>énfasis</strong>");
    expect(result).toContain("https://ejemplo.cl");
  });
});
