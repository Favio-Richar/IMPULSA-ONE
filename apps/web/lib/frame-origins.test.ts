import { mapLinks, RenderBlock } from "@impulza/blocks-renderer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAME_ORIGINS } from "./security-headers";

// F7.3 (ADR-018): cada iframe que puede pintar la página pública sale de una plantilla fija, y su
// origen tiene que estar en `frame-src`. Si alguien suma un proveedor y olvida la CSP, el reproductor
// quedaría en blanco en producción sin que nadie lo note: esta prueba lo atrapa.

const samples: Array<{ type: string; config: unknown }> = [
  { type: "video", config: { video: { provider: "youtube", videoId: "dQw4w9WgXcQ" } } },
  { type: "video", config: { video: { provider: "vimeo", videoId: "76979871" } } },
  { type: "video", config: { video: { provider: "tiktok", videoId: "7312345678901234567", vertical: true } } },
  { type: "music", config: { music: { provider: "spotify", kind: "track", id: "4uLU6hMCjMI75M1A2tKUQC" } } },
  { type: "music", config: { music: { provider: "soundcloud", path: "artista/tema" } } },
  { type: "music", config: { music: { provider: "applemusic", country: "cl", kind: "album", id: "1622045624" } } },
];

describe("orígenes de iframes de la página pública", () => {
  it("todo iframe de video y música, y el mapa, apuntan a un origen permitido por la CSP", () => {
    const origins = new Set<string>();
    for (const [index, sample] of samples.entries()) {
      const html = renderToStaticMarkup(
        createElement(RenderBlock, { block: { type: sample.type, config: sample.config, position: index, primary: false } as never, buttonVariant: "primary" }),
      );
      const src = /<iframe[^>]*src="([^"]+)"/.exec(html)?.[1];
      expect(src, sample.type).toBeDefined();
      origins.add(new URL(src!.replace(/&amp;/g, "&")).origin);
    }
    origins.add(new URL(mapLinks("Calle 1").embed).origin);
    for (const origin of origins) {
      expect(FRAME_ORIGINS as readonly string[], origin).toContain(origin);
    }
    expect(origins.size).toBe(FRAME_ORIGINS.length);
  });
});
