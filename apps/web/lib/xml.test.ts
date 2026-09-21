import { describe, expect, it } from "vitest";
import { escapeXml } from "./xml.js";

describe("escapeXml", () => {
  it("escapa los cinco caracteres reservados de XML", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
  });

  it("no toca un texto sin caracteres reservados", () => {
    expect(escapeXml("https://impulza.one/mi-sitio")).toBe("https://impulza.one/mi-sitio");
  });
});
