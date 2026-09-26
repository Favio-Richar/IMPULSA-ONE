import "../load-dotenv.js";
import { PrismaClient } from "@impulza/database";

// Perfil de demostración (PP8): una página de enlaces **personal** —la de una creadora con sus
// redes, su web, su portafolio, su tienda y su contenido exclusivo—, para ver el producto como lo ve
// quien toca el enlace de una biografía. Solo desarrollo.
//
//   pnpm --filter @impulza/api run demo:perfil
//
// Va por la API real (todas sus validaciones) y es repetible: si la cuenta y el sitio ya existen,
// rehace los bloques y vuelve a publicar. La única escritura directa en la base es marcar el correo
// como verificado, porque en desarrollo el correo no sale a ningún buzón.

const API = process.env.DEMO_API_URL ?? "http://localhost:4000/api/v1";
const WEB = process.env.DEMO_WEB_URL ?? "http://localhost:3300";
const EMAIL = "demo.perfil@example.com";
const PASSWORD = "DemoImpulza2026!";
const ORG_SLUG = "demo-ana-rojas";
const SITE_SLUG = "ana-rojas";

let cookie = "";

async function api<T = unknown>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201, 204]): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length > 0) {
    cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
  }
  const text = await response.text();
  const data = (text ? JSON.parse(text) : null) as T;
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${method} ${path} respondió ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, data };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("El perfil de demostración es solo para desarrollo.");
  }

  const prisma = new PrismaClient();
  try {
    await api("POST", "/auth/register", { email: EMAIL, password: PASSWORD }, [201, 409]);
    await prisma.user.update({ where: { email: EMAIL }, data: { emailVerifiedAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }
  await api("POST", "/auth/login", { email: EMAIL, password: PASSWORD });

  const orgs = (await api<Array<{ id: string; slug: string }>>("GET", "/organizations")).data;
  const org = orgs.find((entry) => entry.slug === ORG_SLUG) ?? (await api<{ id: string }>("POST", "/organizations", { name: "Ana Rojas", slug: ORG_SLUG })).data;
  const orgPath = `/organizations/${org.id}`;

  const sites = (await api<Array<{ id: string; slug: string }>>("GET", `${orgPath}/sites`)).data;
  const site = sites.find((entry) => entry.slug === SITE_SLUG) ?? (await api<{ id: string }>("POST", `${orgPath}/sites`, { name: "Ana Rojas", slug: SITE_SLUG })).data;
  const sitePath = `${orgPath}/sites/${site.id}`;

  // Apariencia: tema de la línea Vibrante y fondo en degradado oscuro (el texto pasa a claro solo).
  const themes = (await api<Array<{ id: string; code: string | null }>>("GET", `${orgPath}/themes`)).data;
  const theme = themes.find((entry) => entry.code === "vibrante-violeta");
  if (theme) {
    await api("PUT", `${sitePath}/theme`, { themeId: theme.id });
  }
  await api("PUT", `${sitePath}/background`, { background: { kind: "gradient", gradient: "medianoche" } });

  const pages = (await api<Array<{ id: string; isHome: boolean }>>("GET", `${sitePath}/pages`)).data;
  const home = pages.find((page) => page.isHome)!;
  const blocksPath = `${sitePath}/pages/${home.id}/blocks`;
  for (const block of (await api<Array<{ id: string }>>("GET", blocksPath)).data) {
    await api("DELETE", `${blocksPath}/${block.id}`);
  }

  const add = async (type: string, config: unknown) => (await api<{ id: string }>("POST", blocksPath, { type, config })).data.id;
  await add("profile", {
    name: "Ana Rojas",
    headline: "Fotógrafa y creadora de contenido · Santiago",
    verified: true,
    socials: [
      { network: "instagram", url: "https://instagram.com/anarojas" },
      { network: "tiktok", url: "https://tiktok.com/@anarojas" },
      { network: "youtube", url: "https://youtube.com/@anarojas" },
      { network: "x", url: "https://x.com/anarojas" },
    ],
  });
  const agenda = await add("link", { label: "Agenda una sesión de fotos", url: "https://calendly.com/anarojas/sesion", style: "primary" });
  await add("link", { label: "Mi portafolio", url: "https://anarojas.cl", style: "secondary" });
  await add("link", { label: "Tienda de presets", url: "https://anarojas.myshopify.com", style: "secondary" });
  await add("link", { label: "Mi canal de YouTube", url: "https://youtube.com/@anarojas", style: "secondary" });
  await add("link", { label: "Podcast en Spotify", url: "https://open.spotify.com/show/anarojas", style: "secondary" });
  await add("link", { label: "Contenido exclusivo", url: "https://onlyfans.com/anarojas", style: "secondary" });
  await add("whatsapp", { phone: "+56912345678", label: "Escríbeme por WhatsApp" });
  await api("PUT", `${blocksPath}/primary`, { blockId: agenda });

  await api("POST", `${sitePath}/pages/${home.id}/publish`, undefined, [200, 201]);

  console.log("\nPerfil de demostración listo.\n");
  console.log(`  Página pública:  ${WEB}/${SITE_SLUG}`);
  console.log(`  Panel:           http://localhost:3100/login`);
  console.log(`  Cuenta:          ${EMAIL}`);
  console.log(`  Contraseña:      ${PASSWORD}  (solo desarrollo)\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
