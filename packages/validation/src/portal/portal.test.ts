import { describe, expect, it } from "vitest";
import { CLIENT_VIEWER_ROLE, clientViewerVerdict, createPublishCommentSchema } from "./index.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const base = `/api/v1/organizations/${ORG}`;
const allowed = (method: string, path: string) => clientViewerVerdict({ method, path: `${base}${path}` }).allowed;

describe("clientViewerVerdict — lo que un visor del portal puede hacer", () => {
  it.each([
    ["GET", ""],
    ["GET", "/panel-brand"],
    ["GET", "/publish-settings"],
    ["GET", "/sites"],
    ["GET", `/sites/${ID}`],
    ["GET", `/sites/${ID}/pages`],
    ["GET", `/sites/${ID}/pages/${ID}`],
    ["GET", `/sites/${ID}/pages/${ID}/publish-status`],
    ["GET", `/sites/${ID}/pages/${ID}/versions`],
    ["GET", `/sites/${ID}/pages/${ID}/versions/${ID}`],
    ["GET", `/sites/${ID}/pages/${ID}/blocks`],
    ["GET", "/publish-requests"],
    ["GET", "/publish-requests?status=PENDING&limit=10"],
    ["GET", `/publish-requests/${ID}`],
    ["GET", `/publish-requests/${ID}/comments`],
    ["POST", `/publish-requests/${ID}/comments`],
    ["POST", `/publish-requests/${ID}/approve`],
    ["POST", `/publish-requests/${ID}/reject`],
  ])("permite %s %s", (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each([
    // Equipo, facturación, cobros y configuración.
    ["GET", "/members"],
    ["POST", "/members"],
    ["GET", "/roles"],
    ["GET", "/billing"],
    ["GET", "/plan"],
    ["GET", "/payment-accounts"],
    ["GET", "/brand-profile"],
    ["GET", "/audit-logs"],
    ["GET", "/agency"],
    // Datos del negocio: contactos, pedidos, reservas, analítica, medios, campañas…
    ["GET", "/contacts"],
    ["GET", "/contacts/export"],
    ["GET", "/orders"],
    ["GET", "/bookings"],
    ["GET", "/analytics/summary"],
    ["GET", "/media"],
    ["GET", "/campaigns"],
    ["GET", "/support-tickets"],
    // Dentro de un sitio: lo que no es leer páginas.
    ["GET", `/sites/${ID}/forms`],
    ["GET", `/sites/${ID}/domains`],
    ["GET", `/sites/${ID}/measurement`],
    ["GET", `/sites/${ID}/theme`],
    ["GET", `/sites/${ID}/catalog/products`],
    // Escribir nunca.
    ["POST", "/sites"],
    ["PATCH", `/sites/${ID}`],
    ["POST", `/sites/${ID}/pages`],
    ["POST", `/sites/${ID}/pages/${ID}/publish`],
    ["POST", `/sites/${ID}/pages/${ID}/publish-requests`],
    ["POST", `/sites/${ID}/pages/${ID}/blocks`],
    ["PUT", "/publish-settings"],
    ["DELETE", `/publish-requests/${ID}`],
    ["POST", `/publish-requests/${ID}/cancel`],
    ["PUT", `/publish-requests/${ID}/comments`],
    ["DELETE", `/publish-requests/${ID}/comments`],
    ["POST", "/panel-brand"],
    ["PATCH", ""],
    ["DELETE", ""],
    // Rutas que no existen todavía: cerradas por defecto.
    ["GET", "/algo-nuevo"],
    ["GET", `/publish-requests/${ID}/otra/cosa`],
  ])("niega %s %s", (method, path) => {
    const verdict = clientViewerVerdict({ method, path: `${base}${path}` });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe("CLIENT_VIEWER_LIMIT");
  });

  it("el rol tiene un nombre estable", () => {
    expect(CLIENT_VIEWER_ROLE).toBe("CLIENT_VIEWER");
  });
});

describe("createPublishCommentSchema", () => {
  it("recorta y exige texto, con tope", () => {
    expect(createPublishCommentSchema.parse({ body: "  Falta el precio  " })).toEqual({ body: "Falta el precio" });
    expect(createPublishCommentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(createPublishCommentSchema.safeParse({}).success).toBe(false);
    expect(createPublishCommentSchema.safeParse({ body: "x".repeat(1001) }).success).toBe(false);
  });
});
