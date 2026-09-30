// Configuración global de Zod. Módulo propio e importado **primero** desde `index.ts`: en ES modules
// los imports se evalúan antes que el cuerpo del módulo que los importa, así que si esto viviera en
// `index.ts` llegaría tarde para cualquier submódulo que ya valide algo al cargarse.
import { z } from "zod";
import { es } from "zod/locales";

// Mensajes de validación en español en todo el sistema: sin esto, cualquier error que no tenga un
// mensaje propio escrito a mano (`.superRefine`, como `safeUrlSchema`) sale con el texto en inglés
// de Zod por defecto ("Too small: expected string to have >=1 characters") — inconsistente con una
// interfaz que es español de punta a punta, tanto en el servidor (mensajes de la API) como en el
// cliente (el motor de campos del constructor, `apps/dashboard/lib/block-fields`). Efecto de
// módulo, una sola vez por proceso: cualquier consumidor de `@impulza/validation` (API, dashboard,
// web) queda cubierto con solo importar este paquete, sin repetir la configuración en cada app.
z.config(es());

// En el navegador, sin compilar validadores con `new Function` (ADR-016): la CSP de la página
// pública no permite `eval`, y Zod igual lo intentaría la primera vez (generando una violación de
// CSP en cada visita). En el servidor no hay CSP y la versión compilada es más rápida.
if (typeof window !== "undefined") {
  z.config({ jitless: true });
}
