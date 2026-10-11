import { describe, expect, it } from "vitest";
import {
  MEMBERS_PER_SITE_MAX,
  MEMBER_TOKEN_PATTERN,
  addMemberSchema,
  listMembersQuerySchema,
  memberCookieName,
  memberEmailSchema,
  requestMemberAccessSchema,
  verifyMemberAccessSchema,
} from "./index.js";

describe("miembros de sitio — validación", () => {
  it("el correo se recorta y se normaliza a minúsculas, y un valor inválido se rechaza", () => {
    expect(memberEmailSchema.parse("  Ana.Rojas@Correo.COM ")).toBe("ana.rojas@correo.com");
    expect(memberEmailSchema.safeParse("no-es-correo").success).toBe(false);
    expect(memberEmailSchema.safeParse(`${"a".repeat(250)}@x.cl`).success).toBe(false);
  });

  it("pedir acceso solo admite el correo (sin campos extra)", () => {
    expect(requestMemberAccessSchema.safeParse({ email: "a@b.cl" }).success).toBe(true);
    expect(requestMemberAccessSchema.safeParse({ email: "a@b.cl", siteId: "x" }).success).toBe(false);
    expect(requestMemberAccessSchema.safeParse({}).success).toBe(false);
  });

  it("el token debe tener exactamente la forma de 32 bytes en base64url", () => {
    const valid = "A".repeat(43);
    expect(verifyMemberAccessSchema.safeParse({ token: valid }).success).toBe(true);
    for (const bad of ["", "corto", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}/`, `${"A".repeat(41)} ;`]) {
      expect(MEMBER_TOKEN_PATTERN.test(bad), bad).toBe(false);
      expect(verifyMemberAccessSchema.safeParse({ token: bad }).success).toBe(false);
    }
  });

  it("el alta envía el acceso por defecto, sanea el nombre y no admite campos extra", () => {
    const parsed = addMemberSchema.parse({ email: "A@B.cl", name: `Ana${String.fromCharCode(0)}${String.fromCharCode(0x202e)} Rojas` });
    expect(parsed).toEqual({ email: "a@b.cl", name: "Ana Rojas", sendAccess: true });
    expect(addMemberSchema.parse({ email: "a@b.cl", sendAccess: false }).sendAccess).toBe(false);
    expect(addMemberSchema.safeParse({ email: "a@b.cl", status: "ACTIVE" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ email: "a@b.cl", name: "x".repeat(121) }).success).toBe(false);
  });

  it("la consulta tiene valores por defecto y topes", () => {
    expect(listMembersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(listMembersQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ status: "BORRADO" }).success).toBe(false);
    expect(MEMBERS_PER_SITE_MAX).toBeGreaterThan(0);
  });

  it("la cookie es una por sitio", () => {
    expect(memberCookieName("mi-sitio")).toBe("impulza_member_mi-sitio");
    expect(memberCookieName("otro")).not.toBe(memberCookieName("mi-sitio"));
  });
});
