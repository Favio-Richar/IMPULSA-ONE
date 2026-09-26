import { describe, expect, it } from "vitest";
import { detectSocialNetwork, SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS } from "./primitives.js";

describe("plataformas de la página de enlaces (PP8)", () => {
  it("cada plataforma tiene su nombre visible", () => {
    for (const network of SOCIAL_NETWORKS) {
      expect(SOCIAL_NETWORK_LABELS[network], network).toBeTruthy();
    }
  });

  it.each([
    ["https://www.instagram.com/ana.rojas", "instagram"],
    ["https://instagram.com/ana.rojas", "instagram"],
    ["https://www.tiktok.com/@ana.rojas", "tiktok"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://m.youtube.com/@anarojas", "youtube"],
    ["https://twitter.com/anarojas", "x"],
    ["https://x.com/anarojas", "x"],
    ["https://onlyfans.com/anarojas", "onlyfans"],
    ["https://www.twitch.tv/anarojas", "twitch"],
    ["https://t.me/anarojas", "telegram"],
    ["https://wa.me/56912345678", "whatsapp"],
    ["https://anarojas.substack.com", "substack"],
    ["https://open.spotify.com/artist/123", "spotify"],
    ["https://music.apple.com/cl/artist/123", "applemusic"],
    ["https://www.behance.net/anarojas", "behance"],
    ["https://calendly.com/anarojas/30min", "calendly"],
    ["https://maps.app.goo.gl/abc123", "googlemaps"],
    ["https://tienda-ana.myshopify.com", "shopify"],
  ])("reconoce %s como %s", (url, network) => {
    expect(detectSocialNetwork(url)).toBe(network);
  });

  it("no se deja engañar por dominios parecidos ni por el texto de la ruta", () => {
    expect(detectSocialNetwork("https://instagram.com.evil.test/login")).toBeNull();
    expect(detectSocialNetwork("https://fakeinstagram.com/ana")).toBeNull();
    expect(detectSocialNetwork("https://mi-portafolio.cl/instagram")).toBeNull();
    expect(detectSocialNetwork("https://goo.gl/abc")).toBeNull();
    expect(detectSocialNetwork("no es una url")).toBeNull();
  });
});
