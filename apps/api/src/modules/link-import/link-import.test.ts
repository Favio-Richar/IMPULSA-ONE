import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseLinkInBio } from "./link-in-bio-parser.js";
import { LinkImportService } from "./link-import.service.js";

const NEXT_DATA = JSON.stringify({
  props: {
    pageProps: {
      links: [
        { title: "Mi tienda", url: "https://tutienda.cl/productos" },
        { title: "Reserva aquí", url: "https://agenda.example.com/ana" },
        { title: "Instagram", url: "https://instagram.com/ana" },
        { title: "Interno", url: "https://linktr.ee/legal/cookies" },
        { title: "Peligroso", url: "javascript:alert(1)" },
        { title: "Repetido", url: "https://tutienda.cl/productos" },
      ],
    },
  },
});
const HTML = `<html><head><title>Ana | Linktree</title></head><body><script id="__NEXT_DATA__" type="application/json">${NEXT_DATA}</script></body></html>`;

describe("importar enlaces desde un «enlace en bio»", () => {
  it("separa redes de enlaces, descarta lo de la plataforma, lo inseguro y los repetidos", () => {
    const parsed = parseLinkInBio(HTML, "linktr.ee");
    expect(parsed.title).toBe("Ana | Linktree");
    expect(parsed.socials).toEqual(["https://instagram.com/ana"]);
    expect(parsed.links).toEqual([
      { label: "Mi tienda", url: "https://tutienda.cl/productos" },
      { label: "Reserva aquí", url: "https://agenda.example.com/ana" },
    ]);
  });

  it("sin JSON incrustado, usa las anclas de la página", () => {
    const parsed = parseLinkInBio('<a href="https://tutienda.cl">Tienda &amp; más</a>', "beacons.ai");
    expect(parsed.links).toEqual([{ label: "Tienda & más", url: "https://tutienda.cl" }]);
  });

  it("solo importa de las plataformas de la lista cerrada (sin SSRF)", async () => {
    const service = new LinkImportService();
    service.fetcher = async () => {
      throw new Error("no debe salir a la red");
    };
    for (const url of ["http://linktr.ee/ana", "https://127.0.0.1/ana", "https://evil.example.com/linktr.ee", "https://linktr.ee.evil.com/ana", "https://linktr.ee:8443/ana", "https://user:pw@linktr.ee/ana"]) {
      await expect(service.importFrom(url), url).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it("una plataforma válida devuelve el resultado; vacío y 404 dan errores claros", async () => {
    const service = new LinkImportService();
    service.fetcher = async () => ({ status: 200, location: null, body: HTML });
    const ok = await service.importFrom("linktr.ee/ana");
    expect(ok.source).toBe("linktree");
    expect(ok.links).toHaveLength(2);

    service.fetcher = async () => ({ status: 404, location: null, body: "" });
    await expect(service.importFrom("https://linktr.ee/nadie")).rejects.toMatchObject({ response: { code: "LINK_IMPORT_NOT_FOUND" } });

    service.fetcher = async () => ({ status: 200, location: null, body: "<html></html>" });
    await expect(service.importFrom("https://linktr.ee/vacia")).rejects.toMatchObject({ response: { code: "LINK_IMPORT_EMPTY" } });

    service.fetcher = async () => ({ status: 302, location: "https://evil.example.com/", body: "" });
    await expect(service.importFrom("https://linktr.ee/ana")).rejects.toMatchObject({ response: { code: "LINK_IMPORT_UNSUPPORTED_SOURCE" } });
  });
});
