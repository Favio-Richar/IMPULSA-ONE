import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from "./permissions.js";

const KNOWN_ROLE_NAMES = [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "ANALYST",
  "SUPPORT",
  "AGENCY_MANAGER",
  "SUPER_ADMIN",
];

describe("catálogo de permisos (F1.6)", () => {
  it("cada rol en ROLE_PERMISSIONS es un rol técnico real (ST §7)", () => {
    for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
      expect(KNOWN_ROLE_NAMES).toContain(roleName);
    }
  });

  it("todo rol técnico real tiene una entrada en ROLE_PERMISSIONS (aunque sea vacía)", () => {
    for (const roleName of KNOWN_ROLE_NAMES) {
      expect(Object.keys(ROLE_PERMISSIONS)).toContain(roleName);
    }
  });

  it("cada permiso asignado a un rol existe en PERMISSION_CATALOG (sin typos)", () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const key of permissions) {
        expect(catalogKeys.has(key)).toBe(true);
      }
    }
  });

  it("SUPER_ADMIN no gana permisos de organización por este mecanismo (ADR-002 §4)", () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual([]);
  });

  it("no hay claves de permiso duplicadas en el catálogo", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
