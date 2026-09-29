import { abVariantFor } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { abBucketFromCookieHeader, hasExperiments, randomAbBucket, resolveExperimentBlocks } from "./ab";

describe("pruebas A/B en el sitio público (F6.5)", () => {
  it("lee el grupo de la cookie propia y rechaza valores inválidos", () => {
    expect(abBucketFromCookieHeader("otra=1; imp_ab=37; x=y")).toBe(37);
    expect(abBucketFromCookieHeader("imp_ab=100")).toBeNull();
    expect(abBucketFromCookieHeader("imp_ab=abc")).toBeNull();
    expect(abBucketFromCookieHeader("imp_abx=3")).toBeNull();
    expect(abBucketFromCookieHeader(null)).toBeNull();
  });

  it("un grupo nuevo siempre cae entre 0 y 99", () => {
    expect(randomAbBucket(() => 0)).toBe(0);
    expect(randomAbBucket(() => 0.999999)).toBe(99);
  });

  it("cada grupo ve la variante que le toca y el render no recibe nada de la prueba", () => {
    const key = "clave-publica";
    const bucketA = [...Array(100).keys()].find((bucket) => abVariantFor(key, bucket) === "a")!;
    const bucketB = [...Array(100).keys()].find((bucket) => abVariantFor(key, bucket) === "b")!;
    const blocks = [
      { position: 0, type: "profile", config: { name: "Ana" } },
      { position: 1, type: "link", config: { label: "Ver", url: "https://example.com" }, experiment: { key, variantB: { label: "Reserva hoy" } } },
    ];
    expect(hasExperiments(blocks)).toBe(true);
    expect(resolveExperimentBlocks(blocks, bucketA)[1]).toEqual({ position: 1, type: "link", config: { label: "Ver", url: "https://example.com" } });
    expect(resolveExperimentBlocks(blocks, bucketB)[1]).toEqual({ position: 1, type: "link", config: { label: "Reserva hoy", url: "https://example.com" } });
    expect(resolveExperimentBlocks(blocks, bucketB)[0]).toEqual(blocks[0]);
  });
});
