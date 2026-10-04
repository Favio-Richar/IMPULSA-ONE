import { describe, expect, it } from "vitest";
import { PERMISSION_MODULES, TEAM_PERMISSION_KEYS, customRoleSchema, memberChangeVerdict, missingPermissions } from "./index.js";

const base = {
  actorMembershipId: "a",
  targetMembershipId: "t",
  targetRoleName: "EDITOR",
  actorPermissions: ["site.update", "page.manage"],
  targetPermissions: ["site.update"],
  granted: ["site.update"],
};

describe("catálogo de módulos", () => {
  it("no repite ningún permiso", () => {
    expect(new Set(TEAM_PERMISSION_KEYS).size).toBe(TEAM_PERMISSION_KEYS.length);
    expect(PERMISSION_MODULES.length).toBeGreaterThan(5);
  });
});

describe("customRoleSchema", () => {
  it("normaliza: recorta, quita duplicados y ordena los permisos", () => {
    const parsed = customRoleSchema.parse({ name: "  Redactor ", description: "", permissions: ["page.manage", "site.update", "page.manage"] });
    expect(parsed).toEqual({ name: "Redactor", description: null, permissions: ["page.manage", "site.update"] });
  });
  it.each([["admin"], ["Agency Manager"], ["owner"], ["x"]])("rechaza el nombre %s", (name) => {
    expect(customRoleSchema.safeParse({ name, permissions: ["site.update"] }).success).toBe(false);
  });
  it("rechaza permisos fuera del catálogo y roles vacíos", () => {
    expect(customRoleSchema.safeParse({ name: "Redactor", permissions: ["todo.poderoso"] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: "Redactor", permissions: [] }).success).toBe(false);
  });
});

describe("missingPermissions", () => {
  it("lista lo que falta, sin repetir", () => {
    expect(missingPermissions(["a"], ["a", "b", "b", "c"])).toEqual(["b", "c"]);
    expect(missingPermissions(["a", "b"], ["a"])).toEqual([]);
  });
});

describe("memberChangeVerdict", () => {
  it("permite un cambio dentro de lo que el actor tiene", () => {
    expect(memberChangeVerdict(base)).toEqual({ allowed: true });
  });
  it("nadie cambia su propio rol", () => {
    expect(memberChangeVerdict({ ...base, targetMembershipId: "a" })).toMatchObject({ allowed: false, code: "SELF_CHANGE" });
  });
  it("el propietario queda protegido", () => {
    expect(memberChangeVerdict({ ...base, targetRoleName: "OWNER" })).toMatchObject({ allowed: false, code: "OWNER_PROTECTED" });
  });
  it("no se actúa sobre quien tiene más permisos que el actor", () => {
    expect(memberChangeVerdict({ ...base, targetPermissions: ["billing.manage"] })).toMatchObject({ allowed: false, code: "TARGET_ABOVE_ACTOR" });
  });
  it("no se entrega lo que no se tiene", () => {
    expect(memberChangeVerdict({ ...base, granted: ["site.update", "billing.manage"] })).toMatchObject({ allowed: false, code: "ESCALATION", missing: ["billing.manage"] });
  });
  it("quitar a alguien (nada que entregar) pasa si no está por encima", () => {
    expect(memberChangeVerdict({ ...base, granted: [] })).toEqual({ allowed: true });
  });
});
