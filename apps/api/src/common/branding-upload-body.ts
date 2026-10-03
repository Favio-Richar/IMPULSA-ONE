import type { NextFunction, Request, Response } from "express";
import { MAX_BRANDING_LOGO_BYTES } from "@impulza/validation";
import { ADMIN_SESSION_COOKIE_NAME } from "../modules/admin/admin-session-cookie.js";

/** Ruta única que recibe un archivo en base64 dentro de un JSON (logo/favicon de la plataforma). */
export const BRANDING_UPLOAD_PATH = "/api/v1/admin/platform/branding/upload";

/** 2 MB de archivo en base64 (+33 %) más el sobre JSON. */
export const BRANDING_UPLOAD_BODY_LIMIT_BYTES = Math.ceil((MAX_BRANDING_LOGO_BYTES * 4) / 3) + 4096;

/**
 * El lector de JSON por defecto de Express limita el cuerpo a 100 KB, y un logo en base64 lo supera
 * con facilidad (F9.1: la subida respondía 413 con cualquier archivo mayor a ~75 KB). Este middleware
 * amplía el límite **solo** para `POST BRANDING_UPLOAD_PATH` y **solo** si la petición trae la cookie de
 * sesión de administración y la cabecera anti-CSRF: nadie sin sesión puede hacerle leer megabytes al
 * servidor. La autorización real sigue siendo de los guards del controlador.
 *
 * Debe registrarse **antes** de que Nest monte su lector de JSON (`app.use` previo a `init`/`listen`):
 * marca `req._body` para que ese segundo lector no vuelva a procesar la petición.
 */
export function brandingUploadBody(limitBytes: number = BRANDING_UPLOAD_BODY_LIMIT_BYTES) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isTarget = req.method === "POST" && req.path === BRANDING_UPLOAD_PATH;
    const isJson = (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
    const hasAdminCookie = (req.headers.cookie ?? "").includes(`${ADMIN_SESSION_COOKIE_NAME}=`);
    const hasCsrfHeader = typeof req.headers["x-requested-with"] === "string";
    if (!isTarget || !isJson || !hasAdminCookie || !hasCsrfHeader) {
      next();
      return;
    }

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limitBytes) {
      res.status(413).json({ statusCode: 413, message: "request entity too large" });
      return;
    }

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
  };
}
