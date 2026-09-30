import { BLOCK_CATALOG, BLOCK_TYPES } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { BLOCK_FIELD_SETS, localDateTimeInDays } from "./catalog";
import { normalizeBlockConfig } from "./normalize";
import { toFormConfig } from "./to-form-value";

// Todo bloque del constructor: lo que se siembra al agregarlo es válido para el servidor, y abrirlo
// en el formulario y guardarlo sin tocar nada devuelve exactamente lo mismo (sin esto, un bloque se
// "modificaría solo" al abrirlo — p. ej. una lista de características o una música guardada).

describe("motor de campos del constructor", () => {
  it("cada tipo del catálogo con editor: semilla válida, e ida y vuelta por el formulario válida y estable", () => {
    for (const type of BLOCK_TYPES) {
      const set = BLOCK_FIELD_SETS[type];
      if (!set) continue;
      const { schema } = BLOCK_CATALOG[type];
      const seeded = schema.safeParse(set.seedConfig());
      expect(seeded.success, `${type}: la semilla no es válida`).toBe(true);
      if (!seeded.success) continue;
      const roundTrip = (config: unknown) => schema.safeParse(normalizeBlockConfig(toFormConfig(config, set.fields), set.fields));
      const again = roundTrip(seeded.data);
      expect.soft(again.success, `${type}: la ida y vuelta no es válida ${again.success ? "" : JSON.stringify(again.error.issues)}`).toBe(true);
      if (!again.success) continue;
      // La primera pasada puede completar valores equivalentes (una casilla opcional en `false`);
      // desde ahí, abrir y guardar ya no cambia nada.
      const third = roundTrip(again.data);
      expect.soft(third.success && third.data, `${type}: abrir y guardar cambia el bloque`).toEqual(again.data);
    }
  });

  it("un perfil guardado antes de PL7 (sin `layout`) se abre y se guarda sin error", () => {
    const set = BLOCK_FIELD_SETS.profile!;
    const form = toFormConfig({ name: "Ana", verified: false }, set.fields);
    expect(form.layout).toBe("avatar");
    expect(BLOCK_CATALOG.profile.schema.safeParse(normalizeBlockConfig(form, set.fields)).success).toBe(true);
  });

  it("los bloques nuevos de F7.3 no cambian en la primera pasada por el formulario", () => {
    for (const type of ["countdown", "pricing", "map", "music", "events"] as const) {
      const set = BLOCK_FIELD_SETS[type]!;
      const seeded = BLOCK_CATALOG[type].schema.parse(set.seedConfig());
      expect(BLOCK_CATALOG[type].schema.parse(normalizeBlockConfig(toFormConfig(seeded, set.fields), set.fields)), type).toEqual(seeded);
    }
  });

  it("los cinco bloques de F7.3 tienen editor", () => {
    for (const type of ["countdown", "pricing", "map", "music", "events"] as const) {
      expect(BLOCK_FIELD_SETS[type], type).toBeDefined();
    }
  });

  it("las características de un plan se escriben una por línea; las vacías no cuentan", () => {
    const set = BLOCK_FIELD_SETS.pricing!;
    const form = toFormConfig({ plans: [{ name: "A", priceAmount: 1, features: ["Uno", "Dos"] }] }, set.fields) as { plans: Array<{ features: string }> };
    expect(form.plans[0]!.features).toBe("Uno\nDos");
    form.plans[0]!.features = "Uno\n\n  Tres  \r\n";
    const normalized = normalizeBlockConfig(form, set.fields) as { plans: Array<{ features: string[] }> };
    expect(normalized.plans[0]!.features).toEqual(["Uno", "Tres"]);
  });

  it("música y videos verticales guardados vuelven al formulario como un enlace que se relee igual", () => {
    const music = BLOCK_FIELD_SETS.music!;
    const stored = { music: { provider: "applemusic", country: "cl", kind: "album", slug: "disco", id: "1622045624", trackId: "1622045628" } };
    expect(toFormConfig(stored, music.fields).music).toBe("https://music.apple.com/cl/album/disco/1622045624?i=1622045628");
    const video = BLOCK_FIELD_SETS.video!;
    expect(toFormConfig({ video: { provider: "youtube", videoId: "dQw4w9WgXcQ", vertical: true } }, video.fields).video).toBe("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    const tiktok = toFormConfig({ video: { provider: "tiktok", videoId: "7312345678901234567", vertical: true } }, video.fields).video as string;
    expect(BLOCK_CATALOG.video.schema.parse({ video: tiktok })).toEqual({ video: { provider: "tiktok", videoId: "7312345678901234567", vertical: true } });
  });

  it("la fecha sembrada cae en la zona del negocio, no en la del navegador", () => {
    // 2026-09-30 02:00 UTC es todavía el 29 en Santiago (UTC-3).
    expect(localDateTimeInDays(0, 20, "America/Santiago", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29T20:00");
    expect(localDateTimeInDays(7, 9, "Europe/Madrid", new Date("2026-09-30T02:00:00Z"))).toBe("2026-10-07T09:00");
  });
});
