import { FONT_FAMILIES } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { FONT_FAMILY_OPTIONS, FONT_GROUPS } from "./theme-fonts";

describe("tipografías del editor de temas", () => {
  it("ofrece cada valor del enum cerrado exactamente una vez, con su grupo", () => {
    expect(FONT_FAMILY_OPTIONS.map((option) => option.value)).toEqual([...FONT_FAMILIES]);
    const groups = new Set(FONT_GROUPS.map((group) => group.id));
    for (const option of FONT_FAMILY_OPTIONS) expect(groups.has(option.group), option.value).toBe(true);
  });

  it("todo grupo tiene al menos una opción y están agrupadas por estilo, no en una lista plana", () => {
    for (const group of FONT_GROUPS) expect(FONT_FAMILY_OPTIONS.some((option) => option.group === group.id), group.id).toBe(true);
    expect(FONT_GROUPS.length).toBeGreaterThanOrEqual(3);
  });
});
