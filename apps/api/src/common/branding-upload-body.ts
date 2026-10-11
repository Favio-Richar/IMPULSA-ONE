import type { NextFunction, Request, Response } from "express";
import { SessionScope, type PrismaClient } from "@impulza/database";
import { MAX_BRANDING_LOGO_BYTES } from "@impulza/validation";
import { ADMIN_SESSION_COOKIE_NAME } from "../modules/admin/admin-session-cookie.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/session-cookie.js";

/** Rutas que reciben un archivo en base64 dentro de un JSON: logo/favicon de la plataforma (F9.1) y de cada organización (F9.2). */
export const PLATFORM_BRANDING_UPLOAD_PATH = "/api/v1/admin/platform/branding/upload";
const ORGANIZATION_BRANDING_UPLOAD_PATH = /^\/api\/v1\/organizations\/[0-9a-f-]{36}\/(?:brand-profile|agency\/white-label)\/upload$/i;

/** 2 MB de archivo en base64 (+33 %) más el sobre JSON. */
export const BRANDING_UPLOAD_BODY_LIMIT_BYTES = Math.ceil((MAX_BRANDING_LOGO_BYTES * 4) / 3) + 4096;

function uploadKind(req: Request): { cookieName: string; scope: SessionScope } | null {
  if (req.method !== "POST") return null;
  if (req.path === PLATFORM_BRANDING_UPLOAD_PATH) return { cookieName: ADMIN_SESSION_COOKIE_NAME, scope: SessionScope.ADMIN };
  if (ORGANIZATION_BRANDING_UPLOAD_PATH.test(req.path)) return { cookieName: SESSION_COOKIE_NAME, scope: SessionScope.USER };
  return null;
}

/**
 * El lector de JSON por defecto de Express limita el cuerpo a 100 KB, y un logo en base64 lo supera con
 * facilidad (F9.1: la subida respondía 413 con cualquier archivo mayor a ~75 KB; F9.2 repitió el defecto en la
 * ruta de la organización). Este middleware amplía el límite **solo** para esas rutas de subida y **solo** si la
 * petición trae una **sesión real y vigente** del tipo correcto (se consulta la base de datos): nadie sin sesión,
 * ni con una cookie inventada, puede hacerle leer megabytes al servidor. La autorización de verdad sigue siendo de
 * los guards del controlador; esto solo decide cuánto cuerpo se lee.
 *
 * Debe registrarse **después** de `cookie-parser` y **antes** de que Nest monte su lector de JSON (`app.use`
 * previo a `init`/`listen`): marca `req._body` para que ese segundo lector no vuelva a procesar la petición.
 */
export function brandingUploadBody(prisma: Pick<PrismaClient, "session">, limitBytes: number = BRANDING_UPLOAD_BODY_LIMIT_BYTES) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const kind = uploadKind(req);
    const isJson = (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
    const hasCsrfHeader = typeof req.headers["x-requested-with"] === "string";
    const sessionId: unknown = kind ? req.cookies?.[kind.cookieName] : undefined;
    if (!kind || !isJson || !hasCsrfHeader || typeof sessionId !== "string" || sessionId.length === 0) {
      next();
      return;
    }

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limitBytes) {
      res.status(413).json({ statusCode: 413, message: "request entity too large" });
      return;
    }

    void (async () => {
      let valid = false;
      try {
        const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { scope: true, expiresAt: true } });
        valid = session !== null && session.scope === kind.scope && session.expiresAt.getTime() > Date.now();
      } catch {
        valid = false; // un identificador mal formado o un fallo de la base: se trata como sin sesión
      }
      if (!valid) {
        next(); // sigue el lector normal (100 KB) y los guards responden 401
        return;
      }
      readJsonBody(req, res, next, limitBytes);
    })();
  };
}

function readJsonBody(req: Request, res: Response, next: NextFunction, limitBytes: number): void {
  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    received += chunk.length;
    if (received > limitBytes) {
      aborted = true;
      res.status(413).json({ statusCode: 413, message: "request entity too large" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (aborted) return;
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.status(400).json({ statusCode: 400, message: "El cuerpo no es un JSON válido." });
      return;
    }
    // Señal que respeta el lector de JSON de Express/Nest para no procesar el cuerpo dos veces.
    (req as Request & { _body?: boolean })._body = true;
    next();
  });
  req.on("error", () => {
    if (!aborted) next(new Error("No se pudo leer el cuerpo de la petición."));
  });
}
