import { describe, expect, it } from "vitest";
import { segmentsAfterOrganization } from "../agency/index.js";
import { AGENCY_MODULE_KEYS, FULL_SCOPE, agencyModuleOfSegments, agencyScopeSchema, scopeAllowsClient, scopeAllowsModule, scopeChangeVerdict, scopeWithin } from "./agency-scope.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const moduleOf = (path: string) => agencyModuleOfSegments(segmentsAfterOrganization(`/api/v1/organizations/${ORG}/${path}`));
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("agencyModuleOfSegments", () => {
  it.each([
    ["sites", "sitios"],
    ["sites/x/pages/y", "sitios"],
    ["sites/x/theme", "sitios"],
    ["sites/x/forms", "contactos"],
    ["contacts", "contactos"],
    ["sites/x/booking/services", "reservas"],
    ["bookings", "reservas"],
    ["sites/x/catalog/products", "catalogo"],
    ["sites/x/coupons", "catalogo"],
    ["orders/abc", "catalogo"],
    ["campaigns", "campanas"],
    ["email-sequences", "campanas"],
    ["media", "medios"],
    ["analytics", "analitica"],
    ["sites/x/funnels", "analitica"],
    ["short-links", "enlaces"],
    ["support-tickets", "soporte"],
    ["brand-profile", "marca"],
    ["ai", "ia"],
    ["publish-requests", "sitios"],
    ["publish-requests/abc/approve", "sitios"],
    ["sites/x/ai", "ia"],
  ])("la ruta %s es del módulo %s", (path, module) => {
    expect(moduleOf(path)).toBe(module);
  });

  it("lo que no es un módulo (la organización misma, el plan, la agencia) no se acota", () => {
    for (const path of ["", "plan", "agency/clients", "agency-link", "members", "roles"]) expect(moduleOf(path)).toBeNull();
  });
});

describe("alcance", () => {
  it("sin restricciones permite todo", () => {
    expect(scopeAllowsClient(FULL_SCOPE, A)).toBe(true);
    expect(scopeAllowsModule(FULL_SCOPE, "medios")).toBe(true);
  });
  it("acotado a clientes y módulos solo permite lo elegido; lo que no es módulo siempre pasa", () => {
    const scope = { allClients: false, clientIds: [A], modules: ["medios"] as const };
    expect(scopeAllowsClient(scope, A)).toBe(true);
    expect(scopeAllowsClient(scope, B)).toBe(false);
    expect(scopeAllowsModule(scope, "medios")).toBe(true);
    expect(scopeAllowsModule(scope, "sitios")).toBe(false);
    expect(scopeAllowsModule(scope, null)).toBe(true);
  });
});

describe("scopeWithin", () => {
  const two = { allClients: false, clientIds: [A, B], modules: ["medios", "sitios"] as const };
  it("quien lo tiene todo puede dar cualquier cosa", () => {
    expect(scopeWithin(FULL_SCOPE, { allClients: false, clientIds: [A], modules: ["medios"] })).toBe(true);
    expect(scopeWithin(FULL_SCOPE, FULL_SCOPE)).toBe(true);
  });
  it("un alcance acotado no puede dar «todos los clientes» ni «todos los módulos»", () => {
    expect(scopeWithin(two, { allClients: true, clientIds: [], modules: ["medios"] })).toBe(false);
    expect(scopeWithin(two, { allClients: false, clientIds: [A], modules: [] })).toBe(false);
  });
  it("ni un cliente o módulo que no tiene", () => {
    expect(scopeWithin(two, { allClients: false, clientIds: [A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"], modules: ["medios"] })).toBe(false);
    expect(scopeWithin(two, { allClients: false, clientIds: [A], modules: ["soporte"] })).toBe(false);
  });
  it("sí un subconjunto", () => {
    expect(scopeWithin(two, { allClients: false, clientIds: [A], modules: ["medios"] })).toBe(true);
  });
});

describe("agencyScopeSchema", () => {
  it("normaliza: sin duplicados y sin residuos con «todos los clientes»", () => {
    expect(agencyScopeSchema.parse({ allClients: true, clientIds: [A], modules: ["medios", "medios"] })).toEqual({ allClients: true, clientIds: [], modules: ["medios"] });
    expect(agencyScopeSchema.parse({ allClients: false, clientIds: [B, A, A] })).toEqual({ allClients: false, clientIds: [A, B], modules: [] });
  });
  it("exige al menos un cliente si no son todos, y rechaza módulos inventados", () => {
    expect(agencyScopeSchema.safeParse({ allClients: false, clientIds: [] }).success).toBe(false);
    expect(agencyScopeSchema.safeParse({ allClients: true, modules: ["todo"] }).success).toBe(false);
    expect(AGENCY_MODULE_KEYS.length).toBeGreaterThan(5);
  });
});

describe("scopeChangeVerdict", () => {
  const base = { actorUserId: "u1", targetUserId: "u2", targetRoleName: "ADMIN", actorScope: FULL_SCOPE, granted: { allClients: false, clientIds: [A], modules: [] } };
  it("permite acotar a otra persona", () => {
    expect(scopeChangeVerdict(base)).toEqual({ allowed: true });
  });
  it("nadie cambia su propio acceso", () => {
    expect(scopeChangeVerdict({ ...base, targetUserId: "u1" })).toMatchObject({ allowed: false, code: "SELF_CHANGE" });
  });
  it("el propietario de la agencia no se acota", () => {
    expect(scopeChangeVerdict({ ...base, targetRoleName: "OWNER" })).toMatchObject({ allowed: false, code: "OWNER_PROTECTED" });
  });
  it("no se da más alcance del que se tiene", () => {
    expect(scopeChangeVerdict({ ...base, actorScope: { allClients: false, clientIds: [B], modules: [] } })).toMatchObject({ allowed: false, code: "SCOPE_ESCALATION" });
  });
});
