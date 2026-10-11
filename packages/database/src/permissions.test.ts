import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG, PERMISSIONS, ROLE_PERMISSIONS } from "./permissions.js";

const KNOWN_ROLE_NAMES = [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "ANALYST",
  "SUPPORT",
  "AGENCY_MANAGER",
  "AGENCY_DELEGATE",
  "CLIENT_VIEWER",
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

  it("todo permiso declarado en PERMISSIONS está descrito en el catálogo (y al revés)", () => {
    // Sin esto, un permiso declarado pero no catalogado nunca se sembraría y el guard siempre
    // denegaría — un fallo silencioso difícil de rastrear desde el 403.
    expect(new Set(PERMISSION_CATALOG.map((p) => p.key))).toEqual(new Set(Object.values(PERMISSIONS)));
  });

  // F9.3 (ADR-028 §2): lo que un cliente nunca delega a su agencia.
  it("AGENCY_DELEGATE no puede gestionar el equipo del cliente, ni cobros, ni su cuenta de Mercado Pago, ni borrar contactos, ni webhooks", () => {
    const delegate = ROLE_PERMISSIONS.AGENCY_DELEGATE!;
    for (const forbidden of [
      PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
      PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
      PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.PAYMENTS_CONNECT,
      PERMISSIONS.PAYMENTS_REFUND,
      PERMISSIONS.CONTACT_DELETE,
      PERMISSIONS.WEBHOOKS_MANAGE,
      PERMISSIONS.AGENCY_MANAGE,
      PERMISSIONS.AGENCY_LINK_MANAGE,
    ]) {
      expect(delegate).not.toContain(forbidden);
    }
    expect(delegate).toContain(PERMISSIONS.PAGE_MANAGE); // sí hace el trabajo de contenido
  });

  it("solo el propietario puede aceptar, rechazar o revocar a una agencia", () => {
    const withLink = Object.entries(ROLE_PERMISSIONS)
      .filter(([, keys]) => keys.includes(PERMISSIONS.AGENCY_LINK_MANAGE))
      .map(([role]) => role);
    expect(withLink).toEqual(["OWNER"]);
  });

  // F9.6c (ADR-028 s3): la compuerta de publicacion.
  it("solo el propietario activa la aprobacion antes de publicar; aprueban el propietario y los administradores", () => {
    const holders = (key: string) =>
      Object.entries(ROLE_PERMISSIONS)
        .filter(([, keys]) => keys.includes(key as never))
        .map(([role]) => role)
        .sort();
    expect(holders(PERMISSIONS.PUBLISH_CONFIGURE)).toEqual(["OWNER"]);
    // El visor del portal aprueba (no publica: no tiene `page.manage`).
    expect(holders(PERMISSIONS.PUBLISH_APPROVE)).toEqual(["ADMIN", "CLIENT_VIEWER", "OWNER"]);
  });

  it("la auditoria es de propietario y administradores; la agencia delegada no la ve", () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, keys]) => keys.includes(PERMISSIONS.AUDIT_VIEW))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual(["ADMIN", "OWNER"]);
  });

  it("la agencia delegada nunca se aprueba a si misma: no tiene publish.approve ni publish.configure", () => {
    const delegate = ROLE_PERMISSIONS.AGENCY_DELEGATE!;
    expect(delegate).not.toContain(PERMISSIONS.PUBLISH_APPROVE);
    expect(delegate).not.toContain(PERMISSIONS.PUBLISH_CONFIGURE);
  });

  it("el visor del portal aprueba y comenta, pero no puede gestionar páginas ni nada más", () => {
    expect([...ROLE_PERMISSIONS.CLIENT_VIEWER!].sort()).toEqual([PERMISSIONS.PUBLISH_APPROVE, PERMISSIONS.PUBLISH_COMMENT].sort());
    expect(ROLE_PERMISSIONS.CLIENT_VIEWER).not.toContain(PERMISSIONS.PAGE_MANAGE);
  });
});
