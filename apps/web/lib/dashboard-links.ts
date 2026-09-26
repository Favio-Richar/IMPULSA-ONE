import { env } from "./env";

// Enlaces server-only hacia apps/dashboard (otro proceso, otro puerto/dominio). Se arman a partir
// de DASHBOARD_BASE_URL, nunca como href relativo ("/bienvenida"), porque esas rutas no existen en
// este proceso de marketing (F2.8: dos apps, dos orígenes). Se pasan como props a los componentes
// cliente (p. ej. MarketingHeader) en vez de que ellos importen `env` directamente, ya que un
// componente "use client" no tiene acceso a variables de entorno server-only.
export function getDashboardLinks() {
  return {
    bienvenidaHref: `${env.DASHBOARD_BASE_URL}/bienvenida`,
    loginHref: `${env.DASHBOARD_BASE_URL}/login`,
  };
}
