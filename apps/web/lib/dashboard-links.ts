import { env } from "./env";

// Enlaces server-only hacia apps/dashboard (otro proceso, otro puerto/dominio). Se arman a partir
// de DASHBOARD_BASE_URL, nunca como href relativo ("/registro"), porque esas rutas no existen en
// este proceso de marketing (F2.8: dos apps, dos orígenes). Se pasan como props a los componentes
// cliente (p. ej. MarketingHeader) en vez de que ellos importen `env` directamente, ya que un
// componente "use client" no tiene acceso a variables de entorno server-only.
export function getDashboardLinks() {
  return {
    // Todo botón dirigido a alguien que aún no tiene cuenta va a /registro: /bienvenida exige sesión y mandaría a /login.
    registroHref: `${env.DASHBOARD_BASE_URL}/registro`,
    loginHref: `${env.DASHBOARD_BASE_URL}/login`,
  };
}

/**
 * Enlaces para usar una plantilla de la galería pública: con cuenta nueva (registro → asistente, que la deja elegida en el
 * paso de plantilla) o con cuenta existente («Crear sitio», con la plantilla ya elegida). El panel guarda `plantilla` y la
 * consume él mismo (`lib/template-intent.ts` de apps/dashboard); el código es un dato, nunca una ruta.
 */
export function getTemplateLinks(code: string) {
  const plantilla = `plantilla=${encodeURIComponent(code)}`;
  return {
    useHref: `${env.DASHBOARD_BASE_URL}/registro?${plantilla}`,
    panelHref: `${env.DASHBOARD_BASE_URL}/sitios/nuevo?${plantilla}`,
  };
}
