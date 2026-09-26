import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileBlock } from "./profile.js";

const avatar = { url: "https://cdn.example.com/ana.webp", alt: "Ana sonriendo" };
const cover = { url: "https://cdn.example.com/portada.webp", alt: "Oficina frente al mar" };

describe("ProfileBlock — encabezado de perfil (PP4)", () => {
  it("un perfil anterior a PP4 (sin portada ni redes) no pinta portada ni fila de redes", () => {
    const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, verified: false }} />);
    expect(html).not.toContain("data-profile-cover");
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("-mt-16");
    expect(html).toContain("<h1");
  });

  it("con portada, el avatar se monta sobre su borde y ambas imágenes se piden primero (LCP)", () => {
    const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, cover, verified: true }} />);
    expect(html).toContain("data-profile-cover");
    expect(html).toContain('alt="Oficina frente al mar"');
    expect(html).toContain("-mt-16");
    expect(html.match(/<img[^>]*fetchPriority="high"/gi)).toHaveLength(2);
    // React además las precarga en el <head>.
    expect(html.match(/<link rel="preload" as="image"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Perfil verificado"');
  });

  it("la fila de redes usa el nombre de cada red como texto accesible y abre ahí mismo (PP8)", () => {
    const html = renderToStaticMarkup(
      <ProfileBlock
        config={{
          name: "Ana",
          verified: false,
          socials: [
            { network: "instagram", url: "https://instagram.com/ana" },
            { network: "tiktok", url: "https://tiktok.com/@ana" },
          ],
        }}
      />,
    );
    expect(html).toContain('aria-label="Redes de Ana"');
    expect(html).toContain('aria-label="Instagram"');
    expect(html).toContain('aria-label="TikTok"');
    expect(html.match(/rel="nofollow"/g)).toHaveLength(2);
    expect(html).not.toContain("target=");
  });

  it("una portada decorativa se oculta a los lectores de pantalla", () => {
    const html = renderToStaticMarkup(
      <ProfileBlock config={{ name: "Ana", verified: false, cover: { ...cover, decorative: true } }} />,
    );
    expect(html).toMatch(/data-profile-cover[^>]*><img[^>]*alt=""/);
  });

  it("sin foto, muestra las iniciales en un monograma (PP8)", () => {
    const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana María Rojas", verified: false }} />);
    expect(html).toMatch(/data-profile-monogram=""[^>]*>AR</);
    expect(renderToStaticMarkup(<ProfileBlock config={{ name: "ana", verified: false }} />)).toMatch(/data-profile-monogram=""[^>]*>A</);
    // Con foto, no hay monograma.
    expect(renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, verified: false }} />)).not.toContain("data-profile-monogram");
  });
});
