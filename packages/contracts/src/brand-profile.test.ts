import { describe, it, expect } from "vitest";
import { brandProfileSchema, resolvedBrandSchema } from "@impulza/validation";
import { brandProfileResponse, resolvedBrandResponse } from "./brand-profile.js";

describe("brand-profile contracts parity", () => {
  it("brandProfileResponse tiene las mismas claves que brandProfileSchema", () => {
    const contractKeys = Object.keys(brandProfileResponse.shape).sort();
    const validationKeys = Object.keys(brandProfileSchema.shape).sort();
    expect(contractKeys).toEqual(validationKeys);
  });

  it("resolvedBrandResponse tiene las mismas claves que resolvedBrandSchema", () => {
    const contractKeys = Object.keys(resolvedBrandResponse.shape).sort();
    const validationKeys = Object.keys(resolvedBrandSchema.shape).sort();
    expect(contractKeys).toEqual(validationKeys);
  });
});
