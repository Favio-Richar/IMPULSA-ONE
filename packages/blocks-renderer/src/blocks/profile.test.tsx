import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileBlock } from "./profile.js";

const avatar = { url: "https://cdn.example.com/ana.webp", alt: "Ana sonriendo" };
const cover = { url: "https://cdn.example.com/portada.webp", alt: "Oficina frente al mar" };

describe("ProfileBlock — encabezado de perfil (PP4)", () => {
  it("un perfil anterior a PP4 (sin portada ni redes) no pinta portada ni redes", () => {
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

  it("las redes son botones de la pila con el nombre de la red visible y abren ahí mismo (ADR-008)", () => {
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
    expect(html).toContain('<span class="font-medium">Instagram</span>');
    expect(html).toContain('<span class="font-medium">TikTok</span>');
    expect(html.match(/min-h-14/g)).toHaveLength(2);
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
  describe("portada de cuerpo entero (PL7)", () => {
    it("con portada: la foto es la cabecera, sin avatar redondo, y el texto va debajo de la foto", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, cover, verified: false, layout: "hero" }} />);
      expect(html).toContain("data-profile-hero");
      expect(html).toContain('alt="Oficina frente al mar"');
      // El avatar no se pinta: solo la portada.
      expect(html).not.toContain('alt="Ana sonriendo"');
      expect(html).not.toContain("rounded-full");
      // Se desvanece con máscara (sirve sobre cualquier fondo) y el nombre queda fuera de la foto.
      expect(html).toContain("mask-image");
      expect(html).toMatch(/data-profile-hero=""[\s\S]*<\/div><div class="-mt-4 w-full"><div class="mt-4[^"]*"><div[^>]*><h1/);
    });

    it("sin portada todavía, muestra las iniciales a lo alto en el lugar de la foto", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana María Rojas", verified: false, layout: "hero" }} />);
      expect(html).toMatch(/data-profile-hero=""[\s\S]*data-profile-monogram=""[^>]*>AR</);
      expect(html).toContain("text-8xl");
    });

    it("sin `layout`, un perfil guardado antes se ve con la foto redonda de siempre", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, cover, verified: false }} />);
      expect(html).not.toContain("data-profile-hero");
      expect(html).toContain("-mt-16");
    });
  });

  describe("banner (editor de portales)", () => {
    it("portada ancha 3:1, foto más chica y circular montada en la esquina, texto alineado a la izquierda", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, cover, verified: false, layout: "banner" }} />);
      expect(html).toContain('data-profile-layout="banner"');
      expect(html).toContain("aspect-[3/1]");
      expect(html).toMatch(/<img[^>]*data-profile-photo="circle"[^>]*h-\[5\.5rem\] w-\[5\.5rem\] rounded-full/);
      expect(html).toContain('alt="Ana sonriendo"');
      expect(html).toContain("text-left");
      expect(html).toMatch(/items-start[^"]*"><div[^>]*><h1/);
      // Las dos imágenes se piden primero (LCP), igual que la clásica.
      expect(html.match(/<img[^>]*fetchPriority="high"/gi)).toHaveLength(2);
    });

    it("sin portada ni foto mantiene la franja y muestra las iniciales en la esquina", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana Rojas", verified: false, layout: "banner" }} />);
      expect(html).toMatch(/data-profile-cover=""[^>]*aspect-\[3\/1\][^>]*><\/div>/);
      expect(html).toMatch(/data-profile-monogram=""[^>]*>AR</);
    });
  });

  describe("recorte (editor de portales)", () => {
    it("la foto no es un círculo: recorte vertical con las esquinas del radio del tema", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, verified: false, layout: "cutout" }} />);
      expect(html).toContain('data-profile-layout="cutout"');
      // Toma el radio del tema (doble), con tope: un tema «redondeado» no lo convierte en óvalo.
      expect(html).toContain('data-profile-photo="cutout"');
      expect(html).toContain("h-40 w-32 rounded-[min(calc(var(--site-radius)*2),2rem)]");
      expect(html).not.toContain("rounded-full");
      expect(html).not.toContain("data-profile-cover");
    });

    it("con portada, el recorte se monta sobre su borde con el marco del fondo", () => {
      const html = renderToStaticMarkup(<ProfileBlock config={{ name: "Ana", avatar, cover, verified: true, layout: "cutout" }} />);
      expect(html).toContain("data-profile-cover");
      expect(html).toContain("-mt-20");
      expect(html).toMatch(/data-profile-photo="cutout"[^>]*border-4 border-\[var\(--site-color-background\)\]/);
      expect(html).toContain('aria-label="Perfil verificado"');
    });
  });
});
