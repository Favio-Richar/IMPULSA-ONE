import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import helmet from "helmet";
import { ADMIN_SESSION_COOKIE_NAME } from "../modules/admin/admin-session-cookie.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/session-cookie.js";

/** Nombre del esquema de seguridad; lo referencian los controladores con `@ApiCookieAuth()`. */
export const SESSION_AUTH = "sesion";
/** Esquema de la sesión de superadministración (ADR-005): cookie y puerta propias. */
export const ADMIN_SESSION_AUTH = "sesionAdmin";

export const OPENAPI_VERSION = "1.0.0";

/** Ruta de la documentación navegable. Fuera de `/api/v1`: no es parte del contrato. */
export const DOCS_PATH = "docs";

/**
 * Construye el documento OpenAPI a partir de la aplicación Nest ya inicializada.
 *
 * Una sola función para los tres consumidores —el servidor que publica la documentación, el script
 * que escribe `docs/api/openapi.json` y la prueba que detecta desincronización— porque si cada uno
 * armara el suyo, el archivo versionado podría no ser el que sirve la API.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Impulza One API")
    .setDescription(
      [
        "API REST de Impulza One. Todo cuelga de `/api/v1` salvo `/health`, que es un endpoint de",
        "infraestructura sin sesión ni CSRF.",
        "",
        "**Autenticación**: cookie de sesión `HttpOnly` (`" + SESSION_COOKIE_NAME + "`), emitida por",
        "`POST /auth/login`. No hay tokens en el cuerpo ni en cabeceras de autorización.",
        "",
        "**CSRF**: toda petición que modifica estado (POST, PATCH, PUT, DELETE) debe enviar la",
        "cabecera `X-Requested-With: impulza-one`. Un formulario o una imagen entre sitios no puede",
        "fijar cabeceras propias, y una petición `fetch` con cabecera custom dispara preflight CORS,",
        "bloqueado salvo origen autorizado. Sin ella la respuesta es 403.",
        "",
        "**Multi-tenant**: los recursos de negocio cuelgan de `/organizations/:organizationId/…`.",
        "Un recurso de otra organización responde **404 y no 403**, para no confirmar que existe",
        "(ADR-002).",
        "",
        "**Errores de validación**: 400 cuando el cuerpo no cumple el esquema de entrada, 422 cuando",
        "cumple la forma pero viola una regla de dominio (contraste insuficiente en un tema,",
        "configuración inválida para un tipo de bloque). Ambos traen `issues` con el campo exacto.",
      ].join("\n"),
    )
    .setVersion(OPENAPI_VERSION)
    .addCookieAuth(SESSION_COOKIE_NAME, { type: "apiKey", in: "cookie" }, SESSION_AUTH)
    .addCookieAuth(ADMIN_SESSION_COOKIE_NAME, { type: "apiKey", in: "cookie" }, ADMIN_SESSION_AUTH)
    .addGlobalParameters({
      name: "X-Requested-With",
      in: "header",
      required: false,
      description:
        "Obligatoria con valor `impulza-one` en toda petición que modifica estado. Ver CsrfGuard.",
      schema: { type: "string", enum: ["impulza-one"] },
    })
    .addTag("auth", "Registro, sesión, recuperación de contraseña y segundo factor.")
    .addTag("organizations", "Organizaciones y sus miembros.")
    .addTag("memberships", "Aceptación de invitaciones (fuera del ámbito de organización).")
    .addTag("sites", "Sitios: CRUD, slug público y tema aplicado.")
    .addTag("pages", "Páginas de un sitio: orden, visibilidad y papelera.")
    .addTag("blocks", "Bloques tipados de una página.")
    .addTag("themes", "Catálogo de temas y temas propios de la organización.")
    .addTag(
      "public-sites",
      "Render público (F2.7): sitios y páginas publicadas, por slug. Sin autenticación.",
    )
    .addTag(
      "admin",
      "Superadministración de la plataforma (ADR-005): sesión propia con 2FA obligatorio. Solo metadatos, nunca datos comerciales de una organización.",
    )
    .addTag("media", "Biblioteca de medios: subida directa al almacenamiento, verificación y procesamiento (ADR-006).")
    .addTag("support", "Solicitudes de soporte desde el panel (F4.5).")
    .addTag("health", "Estado de la API y sus dependencias. Sin autenticación.")
    .addTag("meta", "Raíz de la API. Sanity check, no monitoreo.")
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Monta Swagger UI en `/docs`. **Nunca en producción**: la documentación navegable es una
 * herramienta de desarrollo, y publicarla es regalar el mapa completo de la superficie de ataque.
 * En producción el contrato sigue disponible, pero como archivo versionado en el repositorio.
 *
 * La CSP global es `default-src 'none'` (ST §15), que bloquea los propios assets de swagger-ui
 * aunque sean del mismo origen. Este helmet va **después** del global y solo sobre `/docs`, así
 * que sus cabeceras sobrescriben las del global únicamente en esa ruta. Relajar la CSP global
 * para que la documentación se vea sería pagar en toda la API por una pantalla de desarrollo.
 */
export function setupSwaggerUi(app: INestApplication, nodeEnv: string): boolean {
  if (nodeEnv === "production") {
    return false;
  }

  app.use(
    `/${DOCS_PATH}`,
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // swagger-ui inyecta estilos y su script de arranque inline; no hay forma de servirlo
          // sin esto. Queda contenido en /docs y fuera de producción.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app), {
    swaggerOptions: { persistAuthorization: true },
  });

  return true;
}
