import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@impulza/database";
import { generate } from "otplib";
import { API_BASE_URL, DASHBOARD_URL } from "./playwright.config.js";

// Cabecera CSRF que exige la API en todo método mutante (apps/api/src/common/csrf.guard.ts).
const CSRF_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

export interface SeededFixture {
  organizationId: string;
  siteId: string;
  siteSlug: string;
  pageId: string;
  /** Dueño de la organización sembrada: la administración la busca por este correo (F4.4). */
  ownerEmail: string;
  adminEmail: string;
}

export const FIXTURE_PATH = path.join(import.meta.dirname, ".playwright", "fixture.json");
const SESSION_PATH = path.join(import.meta.dirname, ".playwright", "session.json");
export const ADMIN_SESSION_PATH = path.join(import.meta.dirname, ".playwright", "admin-session.json");

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function api<T>(pathname: string, init: RequestInit & { cookie?: string } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...init,
    headers: { ...CSRF_HEADERS, ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export default async function globalSetup(): Promise<void> {
  const email = `${unique("e2e")}@e2e.test`;

  await api("/auth/register", { method: "POST", body: JSON.stringify({ email, password: PASSWORD }) });

  // El token de verificación llega por email y acá no hay buzón. Se marca el correo como
  // verificado directo en la base: lo que estas pruebas ejercitan es el constructor, no el flujo
  // de alta — ese ya tiene su propia cobertura e2e en apps/api (auth.e2e.test.ts), y duplicarlo
  // acá solo agregaría una forma más de que fallen por un motivo ajeno a lo que miden.
  const prisma = new PrismaClient();
  try {
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }

  const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!loginResponse.ok) {
    throw new Error(`login → ${loginResponse.status}: ${await loginResponse.text()}`);
  }
  const sessionCookie = loginResponse.headers
    .getSetCookie()
    .map((raw) => raw.split(";")[0]!)
    .join("; ");
  const sessionValue = /impulza_session=([^;]+)/.exec(sessionCookie)?.[1];
  if (!sessionValue) {
    throw new Error("El login no devolvió la cookie de sesión impulza_session.");
  }

  const organization = await api<{ id: string }>("/organizations", {
    method: "POST",
    cookie: sessionCookie,
    body: JSON.stringify({ name: "Organización e2e", slug: unique("org") }),
  });

  const siteSlug = unique("sitio");
  const site = await api<{ id: string }>(`/organizations/${organization.id}/sites`, {
    method: "POST",
    cookie: sessionCookie,
    body: JSON.stringify({ name: "Sitio e2e", slug: siteSlug }),
  });

  // Crear un sitio crea su página de inicio; es la que edita el constructor.
  const pages = await api<{ id: string }[]>(`/organizations/${organization.id}/sites/${site.id}/pages`, {
    cookie: sessionCookie,
  });
  const pageId = pages[0]!.id;

  // Contenido suficiente para que el lienzo, el panel de configuración y la vista previa tengan
  // algo real que mostrar — con una pantalla vacía el responsive no se puede juzgar.
  const blocksPath = `/organizations/${organization.id}/sites/${site.id}/pages/${pageId}/blocks`;
  const seedBlocks = [
    { type: "hero", config: { title: "Bienvenido a Impulza", subtitle: "Tu negocio en una sola URL" } },
    { type: "text", config: { html: "<p>Un párrafo de ejemplo para el lienzo.</p>" } },
    { type: "link", config: { label: "Ver nuestros servicios", url: "https://ejemplo.com" } },
  ];
  for (const block of seedBlocks) {
    await api(blocksPath, { method: "POST", cookie: sessionCookie, body: JSON.stringify(block) });
  }

  // Agregados de analítica (F3.7) para que el dashboard tenga una serie, un embudo y rankings
  // reales que mostrar. Directo en la base y no vía el pipeline: Playwright no levanta el worker, y
  // lo que estas pruebas miden es la pantalla, no el pipeline (ese tiene sus propias pruebas e2e en
  // apps/api, F3.6).
  const seedPrisma = new PrismaClient();
  try {
    const rows: Array<{ organizationId: string; siteId: string; period: string; metric: string; value: number }> = [];
    for (let daysAgo = 0; daysAgo < 14; daysAgo++) {
      const period = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const views = 20 + ((daysAgo * 7) % 13);
      const metrics: Record<string, number> = {
        page_view: views,
        "page_view:visitors": Math.round(views * 0.7),
        "page_view:device:mobile": Math.round(views * 0.6),
        "page_view:device:desktop": views - Math.round(views * 0.6),
        "page_view:country:CL": views,
        "page_view:utm_source:instagram": Math.round(views * 0.4),
        [`page_view:subject:${pageId}`]: views,
        block_click: Math.round(views * 0.3),
        lead_created: daysAgo % 3 === 0 ? 1 : 0,
        form_submit: daysAgo % 3 === 0 ? 2 : 0,
      };
      for (const [metric, value] of Object.entries(metrics)) {
        if (value > 0) {
          rows.push({ organizationId: organization.id, siteId: site.id, period, metric, value });
        }
      }
    }
    await seedPrisma.analyticsAggregate.createMany({ data: rows });
  } finally {
    await seedPrisma.$disconnect();
  }

  const { adminEmail } = await seedSuperAdmin();

  const fixture: SeededFixture = { organizationId: organization.id, siteId: site.id, siteSlug, pageId, ownerEmail: email, adminEmail };
  await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(fixture, null, 2));

  // La organización activa es estado de UI que el dashboard guarda en localStorage (zustand
  // persist, lib/active-org-store.ts) — sin esto el constructor muestra "Selecciona una
  // organización" en vez de la página.
  await writeFile(
    SESSION_PATH,
    JSON.stringify({
      cookies: [
        {
          name: "impulza_session",
          value: sessionValue,
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [
        {
          origin: DASHBOARD_URL,
          localStorage: [
            {
              name: "impulza-active-org",
              value: JSON.stringify({ state: { activeOrganizationId: organization.id }, version: 0 }),
            },
          ],
        },
      ],
    }),
  );
}

/**
 * Superadministrador de prueba (F4.4). Se otorga con el **script real** de operación (ADR-005 §2),
 * que es la única vía que existe — así esta preparación también prueba el script — y se lee de su
 * salida la clave TOTP que imprime una sola vez, para iniciar sesión con correo, contraseña y código.
 */
async function seedSuperAdmin(): Promise<{ adminEmail: string; adminSessionValue: string }> {
  const adminEmail = `${unique("admin")}@e2e.test`;
  await api("/auth/register", { method: "POST", body: JSON.stringify({ email: adminEmail, password: PASSWORD }) });
  const prisma = new PrismaClient();
  try {
    await prisma.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }

  // El correo lo genera esta misma función (letras, dígitos y guiones): seguro de pasar en la línea.
  const output = execSync(`pnpm --filter @impulza/api run superadmin -- grant ${adminEmail}`, {
    cwd: path.join(import.meta.dirname, "..", ".."),
    encoding: "utf8",
  });
  const secret = /Clave:\s+([A-Z2-7]+)/.exec(output)?.[1];
  if (!secret) {
    throw new Error(`El script superadmin no imprimió la clave TOTP:\n${output}`);
  }

  const response = await fetch(`${API_BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: adminEmail, password: PASSWORD, code: await generate({ secret }) }),
  });
  if (!response.ok) {
    throw new Error(`login de administración → ${response.status}: ${await response.text()}`);
  }
  const adminSessionValue = /impulza_admin_session=([^;]+)/.exec(response.headers.getSetCookie().join("; "))?.[1];
  if (!adminSessionValue) {
    throw new Error("El login de administración no devolvió la cookie impulza_admin_session.");
  }

  // Misma forma que la cookie real: HttpOnly, SameSite=Strict y acotada a /api/v1/admin.
  await mkdir(path.dirname(ADMIN_SESSION_PATH), { recursive: true });
  await writeFile(
    ADMIN_SESSION_PATH,
    JSON.stringify({
      cookies: [
        {
          name: "impulza_admin_session",
          value: adminSessionValue,
          domain: "localhost",
          path: "/api/v1/admin",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ],
      origins: [],
    }),
  );

  return { adminEmail, adminSessionValue };
}
