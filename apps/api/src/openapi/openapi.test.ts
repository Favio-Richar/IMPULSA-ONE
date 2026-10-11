import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { buildOpenApiDocument } from "./document.js";
import { applyApiPrefix, OPENAPI_FILE, serializeOpenApi } from "./openapi-file.js";

// La pieza que hace cumplir "actualiza OpenAPI si modificas la API" (CLAUDE.md, Definición de
// Terminado). Sin ella ese criterio es una intención que nadie verifica — que es exactamente cómo
// el repositorio llegó hasta F2.5 sin documento OpenAPI.
//
// Compara el documento generado desde la aplicación real contra el archivo versionado. Necesita
// Postgres y Redis arriba, igual que el resto de las pruebas e2e: inicializar los módulos abre sus
// conexiones.

describe("Documento OpenAPI", () => {
  let app: INestApplication;
  let document: ReturnType<typeof buildOpenApiDocument>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // El mismo prefijo que aplica el servidor y el generador: si acá se escribiera a mano, la
    // prueba pasaría comparando un documento que no es el que se sirve.
    applyApiPrefix(app);
    await app.init();

    document = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("coincide con docs/api/openapi.json", async () => {
    const onDisk = await readFile(OPENAPI_FILE, "utf8");

    expect(
      serializeOpenApi(document),
      "El documento OpenAPI quedó desincronizado con la API. Corré `pnpm --filter @impulza/api run openapi:generate` y commiteá docs/api/openapi.json.",
    ).toBe(onDisk);
  });

  it("describe todas las rutas bajo /api/v1, salvo /health", () => {
    const paths = Object.keys(document.paths);

    expect(paths).toContain("/health");
    for (const routePath of paths) {
      if (routePath === "/health") {
        continue;
      }
      expect(routePath.startsWith("/api/v1")).toBe(true);
    }
  });

  it("no deja ninguna operación sin resumen ni etiqueta", () => {
    // Una operación sin `summary` o sin `tags` sale en la documentación como una fila vacía: está
    // técnicamente descrita y no dice nada. Se comprueba acá para que agregar un endpoint sin
    // anotarlo falle en CI en vez de degradar el documento en silencio.
    const sinAnotar: string[] = [];

    for (const [routePath, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (typeof operation !== "object" || operation === null || !("responses" in operation)) {
          continue;
        }
        const { summary, tags } = operation as { summary?: string; tags?: string[] };
        if (!summary || !tags || tags.length === 0) {
          sinAnotar.push(`${method.toUpperCase()} ${routePath}`);
        }
      }
    }

    expect(sinAnotar).toEqual([]);
  });

  it("protege con cookie de sesión toda operación que no sea pública", () => {
    // Las públicas son las de `/auth` sin sesión (registro, login, recuperación), `/health` y la
    // raíz. Cualquier otra operación sin `security` sería una que se documenta como abierta: si
    // eso pasa, o falta la anotación o falta el guard, y ambas cosas hay que mirarlas.
    const PUBLICAS = new Set([
      "GET /api/v1",
      "GET /health",
      "POST /api/v1/auth/register",
      "POST /api/v1/auth/verify-email",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/forgot-password",
      "POST /api/v1/auth/reset-password",
      "GET /api/v1/public/sites/{siteSlug}",
      "GET /api/v1/public/sites/{siteSlug}/pages/{pageSlug}",
      "GET /api/v1/public/sites/{siteSlug}/forms/{formId}",
      "POST /api/v1/public/sites/{siteSlug}/forms/{formId}/submissions",
      "POST /api/v1/public/sites/{siteSlug}/events",
      "GET /api/v1/public/short-links/{slug}",
      "GET /api/v1/public/qr/{qrCodeId}",
      // Catálogo de planes (F4.1): los precios de un SaaS son públicos (página de precios).
      "GET /api/v1/plans",
      // Catálogo de plantillas (PL1): contenido de la plataforma, sin datos de tenant; lo lee la
      // galería del onboarding antes de que exista una organización. Con límite de tasa por IP.
      "GET /api/v1/templates",
      "GET /api/v1/templates/{code}",
      // Marca de la plataforma (F9.1, ADR-028 §4): solo campos públicos, sin credenciales internas.
      "GET /api/v1/platform/branding",
      // Login de superadministración (F4.4): abre la sesión, no puede exigirla. Contraseña + 2FA.
      "POST /api/v1/admin/auth/login",
      // Resolución de dominios propios (F4.7): la llama el `proxy` de apps/web sin sesión en cada
      // visita a un dominio propio. Solo devuelve el slug de un dominio verificado; límite de tasa.
      "GET /api/v1/public/domains/{hostname}",
      // Resolución del portal de una agencia (F9.7d): sin sesión, solo la marca pública de una agencia con dominio verificado; límite de tasa.
      "GET /api/v1/public/portal/{hostname}",
      // Informe compartido (F9.8b): el token es la credencial; vence, se revoca, solo cifras agregadas y con límite de tasa.
      "GET /api/v1/public/reports/{token}",
      "GET /api/v1/public/reports/{token}/csv",
      // Reserva pública (F5.2): el visitante no tiene sesión. CSRF, límite de tasa y antispam.
      "GET /api/v1/public/sites/{siteSlug}/booking",
      "GET /api/v1/public/sites/{siteSlug}/booking/availability",
      // Smart CTA (F6.6): solo sí/no "¿quedan horas?", sin horarios; lo consulta apps/web.
      "GET /api/v1/public/sites/{siteSlug}/booking/available",
      "POST /api/v1/public/sites/{siteSlug}/booking",
      // Catálogo y pedidos (F5.5): el visitante no tiene sesión. CSRF, límite de tasa y antispam.
      "GET /api/v1/public/sites/{siteSlug}/catalog",
      "POST /api/v1/public/sites/{siteSlug}/catalog/orders",
      // Baja de campañas (F5.6): la credencial es el enlace firmado del correo, no una sesión.
      "GET /api/v1/public/unsubscribe/{token}",
      "POST /api/v1/public/unsubscribe/{token}",
      // Newsletter (F7.4, ADR-019): la solicitud desde la página pública y el enlace del correo,
      // que es la única credencial para confirmar. Con límite de tasa por IP.
      "POST /api/v1/public/sites/{siteSlug}/newsletter",
      "GET /api/v1/public/newsletter/{token}",
      "POST /api/v1/public/newsletter/{token}",
      // "Gestiona tu reserva" (F5.4): la credencial es el enlace firmado del correo, no una sesión.
      "GET /api/v1/public/bookings/{token}",
      "POST /api/v1/public/bookings/{token}/cancel",
      "POST /api/v1/public/bookings/{token}/reschedule",
      // "Tu pedido" (F5.9): la credencial es el enlace del correo (o el regreso de Mercado Pago).
      "GET /api/v1/public/orders/{token}",
      // Cupones (F7.8b, ADR-023): probar un código antes de pedir. No revela qué códigos existen
      // (respuesta uniforme), no cuenta un uso y tiene un tope estricto por visitante.
      "POST /api/v1/public/sites/{siteSlug}/catalog/coupons/check",
      // Carrito (F7.8c, ADR-023): el pedido de varias líneas y su prueba de código, con los mismos
      // cupos por visitante que el pedido suelto y la prueba de código.
      "POST /api/v1/public/sites/{siteSlug}/catalog/cart/coupons/check",
      "POST /api/v1/public/sites/{siteSlug}/catalog/cart/orders",
      // Descargas pagadas (F5.11b): la credencial es el enlace firmado del correo; el pago se verifica en cada uso.
      "GET /api/v1/public/downloads/{token}",
      "POST /api/v1/public/downloads/{token}/url",
      // Feed iCal (F7.9c, ADR-024): suscripción universal (.ics) mediante token seguro en URL para calendarios externos.
      "GET /api/v1/public/bookings/calendar-feed/{token}.ics",
    ]);

    const sinSeguridad: string[] = [];

    for (const [routePath, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (typeof operation !== "object" || operation === null || !("responses" in operation)) {
          continue;
        }
        const id = `${method.toUpperCase()} ${routePath}`;
        const { security } = operation as { security?: unknown[] };
        if (!PUBLICAS.has(id) && (!security || security.length === 0)) {
          sinSeguridad.push(id);
        }
      }
    }

    expect(sinSeguridad).toEqual([]);
  });
});
