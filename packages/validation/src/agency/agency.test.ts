import { describe, expect, it } from "vitest";
import {
  AGENCY_CLIENT_ACTIONS,
  AGENCY_CLIENT_STATUSES,
  createAgencyClientSchema,
  delegatedAccessVerdict,
  linkAgencyClientSchema,
  nextAgencyClientStatus,
  segmentsAfterOrganization,
  type AgencyClientStatusValue,
} from "../index.js";

// F9.3 (ADR-028 §2): el veredicto de acceso delegado es UNA función pura y se prueba entera.

const ORG = "00000000-0000-4000-8000-000000000001";
const path = (rest: string) => `/api/v1/organizations/${ORG}/${rest}`;
const verdict = (status: AgencyClientStatusValue, method: string, rest: string, agencyCreated = true) =>
  delegatedAccessVerdict({ status, agencyCreated, method, path: path(rest) });

describe("delegatedAccessVerdict — estados de la relación", () => {
  it("ACTIVE y TRANSFERRING dan acceso completo al trabajo de contenido", () => {
    for (const status of ["ACTIVE", "TRANSFERRING"] as const) {
      expect(verdict(status, "GET", "sites").allowed).toBe(true);
      expect(verdict(status, "POST", "sites").allowed).toBe(true);
      expect(verdict(status, "PUT", "brand-profile").allowed).toBe(true);
    }
  });

  it("PAUSED es solo lectura", () => {
    expect(verdict("PAUSED", "GET", "sites").allowed).toBe(true);
    expect(verdict("PAUSED", "HEAD", "sites").allowed).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = verdict("PAUSED", method, "sites");
      expect(result).toMatchObject({ allowed: false, code: "AGENCY_CLIENT_PAUSED" });
    }
  });

  it("ARCHIVED y ENDED no dan ningún acceso, ni de lectura", () => {
    expect(verdict("ARCHIVED", "GET", "sites")).toMatchObject({ allowed: false, code: "AGENCY_CLIENT_ARCHIVED" });
    expect(verdict("ENDED", "GET", "sites")).toMatchObject({ allowed: false, code: "AGENCY_ACCESS_REVOKED" });
  });

  it("INVITED da acceso solo si la agencia creó al cliente; una solicitud sobre un negocio existente no, hasta que acepte", () => {
    expect(verdict("INVITED", "POST", "sites", true).allowed).toBe(true);
    expect(verdict("INVITED", "GET", "sites", false)).toMatchObject({ allowed: false, code: "AGENCY_ACCESS_NOT_ACCEPTED" });
  });
});

describe("delegatedAccessVerdict — límites duros (lo que el cliente nunca delega)", () => {
  const hard: Array<[string, string, string]> = [
    ["su cuenta de cobro (lectura)", "GET", "payment-accounts"],
    ["su cuenta de cobro (conectar)", "POST", "payment-accounts/mercado-pago"],
    ["su suscripción", "POST", "billing/checkout"],
    ["su suscripción (lectura)", "GET", "billing"],
    ["su equipo (listar)", "GET", "members"],
    ["su equipo (invitar)", "POST", "members"],
    ["cambiar el rol de alguien o al propietario", "PATCH", `members/${ORG}`],
    ["remover a alguien o al propietario", "DELETE", `members/${ORG}`],
    ["exportar los datos de un contacto", "GET", `contacts/${ORG}/export`],
  ];
  it.each(hard)("bloquea %s con AGENCY_LIMIT, también con la relación activa", (_label, method, rest) => {
    expect(verdict("ACTIVE", method, rest)).toMatchObject({ allowed: false, code: "AGENCY_LIMIT" });
  });

  it("el plan solo se lee", () => {
    expect(verdict("ACTIVE", "GET", "plan").allowed).toBe(true);
    expect(verdict("ACTIVE", "PUT", "plan")).toMatchObject({ allowed: false, code: "AGENCY_LIMIT" });
  });

  it("un segmento parecido no se confunde: `members-report` no es `members`", () => {
    expect(verdict("ACTIVE", "GET", "members-report").allowed).toBe(true);
  });

  it("ignora el query y el prefijo de versión", () => {
    expect(delegatedAccessVerdict({ status: "ACTIVE", agencyCreated: true, method: "GET", path: `/organizations/${ORG}/billing?x=1` })).toMatchObject({ allowed: false });
  });
});

describe("segmentsAfterOrganization", () => {
  it("devuelve lo que viene después del identificador de la organización", () => {
    expect(segmentsAfterOrganization(path("sites/abc/pages"))).toEqual(["sites", "abc", "pages"]);
    expect(segmentsAfterOrganization(`/api/v1/organizations/${ORG}`)).toEqual([]);
    expect(segmentsAfterOrganization("/api/v1/auth/me")).toEqual([]);
  });
});

describe("nextAgencyClientStatus — transiciones", () => {
  it("pausar solo desde ACTIVE y reanudar solo desde PAUSED", () => {
    expect(nextAgencyClientStatus("pause", "ACTIVE")).toBe("PAUSED");
    expect(nextAgencyClientStatus("pause", "PAUSED")).toBeNull();
    expect(nextAgencyClientStatus("resume", "PAUSED")).toBe("ACTIVE");
    expect(nextAgencyClientStatus("resume", "ACTIVE")).toBeNull();
  });

  it("archivar desde ACTIVE, PAUSED o INVITED; desarchivar solo desde ARCHIVED", () => {
    for (const status of ["ACTIVE", "PAUSED", "INVITED"] as const) expect(nextAgencyClientStatus("archive", status)).toBe("ARCHIVED");
    expect(nextAgencyClientStatus("archive", "ENDED")).toBeNull();
    expect(nextAgencyClientStatus("unarchive", "ARCHIVED")).toBe("ACTIVE");
    expect(nextAgencyClientStatus("unarchive", "ACTIVE")).toBeNull();
  });

  it("soltar termina cualquier relación abierta y nunca una ya terminada", () => {
    for (const status of AGENCY_CLIENT_STATUSES) {
      expect(nextAgencyClientStatus("release", status)).toBe(status === "ENDED" ? null : "ENDED");
    }
  });

  it("ninguna acción saca a un cliente de ENDED", () => {
    for (const action of AGENCY_CLIENT_ACTIONS) expect(nextAgencyClientStatus(action, "ENDED")).toBeNull();
  });
});

describe("esquemas de entrada", () => {
  it("el alta normaliza el correo y exige datos válidos", () => {
    const parsed = createAgencyClientSchema.parse({ name: "Café Sol", slug: "cafe-sol", ownerEmail: "  Dueno@Cafe.CL " });
    expect(parsed.ownerEmail).toBe("dueno@cafe.cl");
    expect(parsed.billingMode).toBe("CLIENT_PAYS");
    expect(createAgencyClientSchema.safeParse({ name: "x", slug: "cafe-sol", ownerEmail: "a@b.cl" }).success).toBe(false);
    expect(createAgencyClientSchema.safeParse({ name: "Café", slug: "Mal Slug", ownerEmail: "a@b.cl" }).success).toBe(false);
    expect(createAgencyClientSchema.safeParse({ name: "Café", slug: "cafe-sol", ownerEmail: "no-es-correo" }).success).toBe(false);
  });

  it("vincular pide el identificador Y el correo del propietario", () => {
    expect(linkAgencyClientSchema.safeParse({ clientSlug: "cafe-sol" }).success).toBe(false);
    expect(linkAgencyClientSchema.safeParse({ clientSlug: "cafe-sol", ownerEmail: "a@b.cl" }).success).toBe(true);
  });
});
