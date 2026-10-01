# ADR-025: Arquitectura de páginas institucionales y comerciales de Impulza One (`/soluciones`, `/integraciones`, `/recursos`, `/privacidad`)

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §7, §9.3 y F7.10 de `docs/BACKLOG_FASE_7.md`.

## Contexto

Impulza One cuenta con portada comercial (`/`), páginas de producto (`/producto`), plantillas (`/plantillas`), planes (`/planes`) y términos (`/terminos`). Para completar la presencia institucional de la plataforma descrita en el Plan Maestro §7 y habilitar la captación orientada por industrias, se requiere implementar:
1. **Soluciones por rubro (`/soluciones`)**: aterrizaje comercial para verticales clave (salud y bienestar, gastronomía y servicios locales, creadores de contenido, tiendas y comercio, servicios profesionales, educación y eventos).
2. **Integraciones (`/integraciones`)**: catálogo transparente de las conexiones reales de la plataforma (Webpay, Mercado Pago, Google Calendar, feed iCal, Zapier, Make, GA4, Meta Pixel, WhatsApp).
3. **Recursos (`/recursos`)**: centro de guías de inicio, buenas prácticas de conversión y enlaces a soporte y estado.
4. **Política de privacidad (`/privacidad`)**: marco normativo conforme a la Ley 19.628 y la Ley 21.719 de Protección de Datos Personales de Chile y principios de privacidad por diseño (ADR-004).

## Decisión

1. **Estilo visual sobrio e institucional**: Fondo claro (`#ffffff` y `#f8fafc`), paleta tipográfica oscura de alto contraste (`#0f172a` y `#475569`), acento de marca corporativo `#0f6f6b` y bordes sutiles `#e2e8f0`. El sitio comercial de Impulza One mantiene una estética SaaS sobria, accesible y formal, diferenciada explícitamente del estilo visual "enlace en bio" de las páginas públicas de los clientes (ADR-008).
2. **Server Components puros y desacople de runtime**: Las páginas institucionales se renderizan como Server Components de Next.js sin dependencias bloqueantes de la API interna en tiempo de compilación. Esto previene fallos en despliegues y asegura disponibilidad ininterrumpida de las páginas de captación y legal.
3. **Datos declarativos y tipados en TypeScript**: Las definiciones de soluciones, rubros e integraciones se estructuran en módulos tipados bajo `apps/web/lib/marketing/`, facilitando pruebas unitarias, consistencia de enlaces y extensibilidad sin sobrecarga de base de datos ni CMS externo.
4. **Arquitectura de información y accesibilidad**:
   - `MarketingHeader` y `MarketingFooter` incorporan navegación clara a las nuevas secciones.
   - Cumplimiento de WCAG 2.2 AA (contraste superior a 4.5:1, etiquetas semánticas, navegación por teclado y menú móvil desplegable).
5. **Privacidad y cumplimiento normativo**:
   - `/privacidad` expone de forma transparente la identidad del responsable, finalidades del tratamiento, medidas de seguridad aplicadas (AES-256-GCM, Argon2id, HMAC), derechos ARCO y el rol de encargado en relación a los contactos de los clientes finales.

## Consecuencias

- **Positivas**: presencia comercial completa y coherente; captación por industria; confianza para clientes corporativos; cumplimiento legal estricto.
- **Negativas**: requiere mantener sincronizado el catálogo de integraciones a medida que se incorporen nuevos conectores en fases posteriores.
