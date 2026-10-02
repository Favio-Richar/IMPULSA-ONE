import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { redactPath } from "./common/redact-path.js";

// Auditoría estática de seguridad de los controladores (F7.12). Lee el código fuente y falla si una
// ruta rompe una regla que antes solo se revisaba a mano. Cada regla nació de un defecto real:
// - `@RateLimit` sin `RateLimitGuard` no limita nada (el feed iCal lo tuvo, F7.12).
// - Un token en la URL que `redactPath` no oculta termina en los logs y en Sentry (F7.9c).
// - Una ruta de una organización que modifica datos sin permiso concreto confía en la membresía.

const SRC = resolve(import.meta.dirname);
const MODULES = join(SRC, "modules");

interface Route {
  file: string;
  verb: string;
  base: string;
  path: string;
  /** Decoradores de la ruta (hasta la firma del método) más los del controlador. */
  block: string;
  classHead: string;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

function loadRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(MODULES)) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const chunk of source.split(/(?=@Controller\()/).slice(1)) {
      const base = /@Controller\(\s*"([^"]*)"/.exec(chunk)?.[1] ?? "";
      const classIndex = chunk.indexOf("export class");
      const classHead = chunk.slice(0, classIndex);
      for (const part of chunk.slice(classIndex).split(/\n\s*(?=@(?:Get|Post|Put|Patch|Delete)\()/).slice(1)) {
        const match = /^@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?/.exec(part);
        if (!match) continue;
        routes.push({
          file: relative(SRC, file).split(sep).join("/"),
          verb: match[1]!.toUpperCase(),
          base,
          path: `/${base}${match[2] ? `/${match[2]}` : ""}`.replace(/\/+/g, "/"),
          block: part.split(/\n\s*(?:async\s+)?[a-zA-Z]+\(/)[0]!,
          classHead,
        });
      }
    }
  }
  return routes;
}

const ROUTES = loadRoutes();
const label = (route: Route): string => `${route.verb} ${route.path} (${route.file})`;

describe("auditoría estática de seguridad de los controladores (F7.12)", () => {
  it("encuentra las rutas (guarda contra una auditoría vacía)", () => {
    expect(ROUTES.length).toBeGreaterThan(250);
  });

  it("toda ruta con @RateLimit tiene RateLimitGuard: sin el guard el decorador no limita nada", () => {
    const sinGuard = ROUTES.filter((route) => /@RateLimit\(/.test(route.block + route.classHead)).filter(
      (route) => !/RateLimitGuard/.test(route.block + route.classHead),
    );
    expect(sinGuard.map(label)).toEqual([]);
  });

  it("toda ruta pública (/public/…) tiene límite de peticiones", () => {
    const sinLimite = ROUTES.filter((route) => route.base === "public" || route.base.startsWith("public/")).filter(
      (route) => !/@RateLimit\(/.test(route.block + route.classHead),
    );
    expect(sinLimite.map(label)).toEqual([]);
  });

  it("todo token que viaja en la ruta queda oculto por redactPath (logs y Sentry)", () => {
    const token = "a".repeat(48);
    const conToken = ROUTES.filter((route) => /:(token|code|secret|signature)\b/.test(route.path) && route.path.startsWith("/public"));
    expect(conToken.length).toBeGreaterThan(5);
    const filtradas = conToken
      .map((route) => ({ route, logged: redactPath(`/api/v1${route.path.replace(/:(token|code|secret|signature)\b/, token)}`)! }))
      .filter(({ logged }) => logged.includes(token));
    expect(filtradas.map(({ route }) => label(route))).toEqual([]);
  });

  it("toda ruta de una organización que modifica datos exige un permiso concreto, salvo las justificadas", () => {
    // Justificadas: abrir un ticket de soporte lo puede hacer cualquier miembro; la audiencia de una
    // campaña es una lectura que usa POST por el cuerpo; la lectura comercial con IA es para ANALYST
    // ("solo lectura de analítica y reportes") y ya tiene límite de plan y de peticiones.
    const JUSTIFICADAS = new Set([
      "POST /organizations/:organizationId/support-tickets",
      "POST /organizations/:organizationId/support-tickets/:ticketId/messages",
      "POST /organizations/:organizationId/campaigns/audience",
      "POST /organizations/:organizationId/sites/:siteId/ai/insights",
    ]);
    const sinPermiso = ROUTES.filter((route) => route.base.startsWith("organizations/:organizationId") && route.verb !== "GET")
      .filter((route) => !/@RequirePermission\(/.test(route.block + route.classHead))
      .filter((route) => !JUSTIFICADAS.has(`${route.verb} ${route.path}`));
    expect(sinPermiso.map(label)).toEqual([]);
  });
});
