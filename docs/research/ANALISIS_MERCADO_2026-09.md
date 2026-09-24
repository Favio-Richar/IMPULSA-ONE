# Análisis de mercado — septiembre 2026

- **Fecha:** 2026-09-24
- **Propósito:** contrastar lo construido (Fases 0–4.4) con la competencia actual, para decidir
  prioridades de producto y diseño **sin reabrir** el plan maestro (§2 Referencias y §14
  Diferenciadores ya fijan la estrategia). Las recomendaciones de §5 que cambian el orden del backlog
  **requieren aprobación de Favio**: este documento no las autoriza por sí mismo.
- **Regla vigente (CLAUDE.md):** Linktree, HeyLink, Beacons y Stan son referencias **funcionales**,
  nunca visuales.

## 1. Precios de la competencia (septiembre 2026, USD/mes)

| Producto | Gratis | Planes pagados | Comisión por venta | Dominio propio |
|---|---|---|---|---|
| Linktree | Sí | Starter $8 · Pro $15 · Premium $35 (subió Pro de ~$9 a $15 en nov. 2025) | 12 % gratis, 9 % hasta Premium, 0 % en Premium | Recién desde Pro según algunas fuentes; su propia ayuda dice que no reemplaza `linktr.ee/usuario` |
| Beacons | Sí (con email básico) | Creator Plus ~$30 | 9 % gratis, 0 % pagado | Pagado |
| Stan Store | No (prueba de 14 días) | $29 · $99 | 0 % | — (la página es secundaria a la tienda) |
| Taplink (fuerte en LATAM) | Sí | Pagados bajos | — | Pagado |

Planes provisorios de Impulza One (decisión #4, editables desde `apps/admin`): Gratis, Profesional
CLP 7.990, Negocio CLP 19.990, Agencia CLP 49.990. Los dos primeros quedan en el rango de Linktree
Starter/Pro. Hoy no cobramos comisión porque aún no hay venta (Fase 5).

## 2. Quejas recurrentes de los usuarios de la competencia

1. **Diseño restrictivo y genérico.** En Linktree las opciones de diseño del plan gratis son muy
   pocas y la página "se parece a todas". Beacons tiene más libertad, pero su interfaz se siente
   recargada.
2. **Analítica pobre en el plan gratis.** En Linktree prácticamente no existe hasta pagar, y la
   analítica por enlace es de pago.
3. **Sin dominio propio o caro.** Es la queja de marca profesional más citada.
4. **Sin captación real de contactos.** Linktree no sirve si necesitas formularios de captación o
   un CRM.
5. **Comisiones que castigan el crecimiento** (Linktree 9–12 %).
6. **Sin QR nativo** en Linktree, Beacons ni Stan.
7. **Soporte y cobros:** quejas constantes de facturación, soporte y acceso a la cuenta
   (Trustpilot, Reddit, G2).

## 3. Contexto Chile / LATAM

- Chile tiene alrededor de 15 millones de usuarios de WhatsApp en una población de 19 millones, una
  de las penetraciones más altas de la región. Además, ~72 % del comercio conversacional de LATAM pasa
  por WhatsApp.
- La economía de creadores en LATAM crece a ~27 % anual, 1,8 veces el ritmo global.
- En LATAM se usan Taplink y Shorby justamente porque tratan WhatsApp como botón principal, no como
  un enlace más.
- La Ley 21.719 rige desde diciembre de 2026. Ninguna herramienta extranjera de "link in bio"
  comunica cumplimiento local de consentimiento y retención.

## 4. Dónde está Impulza One hoy

| Punto de dolor del mercado | Estado en Impulza One | Fase |
|---|---|---|
| Captación de contactos y CRM | **Resuelto:** formularios reales, mini-CRM con estado comercial y consentimiento auditado | F3.2–F3.3 |
| Analítica útil desde el plan gratis | **Resuelto:** embudo, series, dispositivos, países y UTM; Gratis ve 30 días | F3.6–F3.7 |
| QR nativo y enlaces cortos | **Resuelto** (ningún competidor principal lo tiene nativo) | F3.5 |
| WhatsApp como acción principal | **Resuelto:** bloque propio con mensaje precargado y clic medido | F3.4 |
| Cumplimiento Ley 21.719 | **Resuelto de diseño:** consentimiento, minimización y revisión a 36 meses | ADR-004 |
| Soporte humano confiable | **En curso:** F4.5 | F4.5 |
| Dominio propio | **Pendiente:** F4.7, parcialmente bloqueada por la decisión #1 | F4.7 |
| **Diseño que no se vea genérico** | **Brecha principal**, ver §5 | — |
| Venta sin comisiones | Pendiente | Fase 5 |

## 5. Implicaciones de diseño (la brecha principal)

Funcionalmente ya superamos a Linktree en captación, analítica, QR y WhatsApp. Lo que un visitante ve
primero, la página pública, todavía es sobria: no tiene foto de perfil, portada ni galería, porque
**no existe subida de archivos**. Los bloques `profile.avatar`, `hero.background`, `image` y `gallery`
ya existen en el catálogo, pero sin almacenamiento no se pueden usar. Esto depende de la **decisión
#7 (almacenamiento y cuotas)**.

Recomendaciones, en orden de impacto:

1. **Resolver la decisión #7 cuanto antes** y agregar la subida de imágenes (S3/R2 por
   `StorageAdapter`, ST §3.4). Sin foto de perfil ni portada, ninguna mejora de estilo alcanza el
   nivel "más profesional que la competencia". *Requiere tu decisión.*
2. **Temas con carácter propio**, no plantillas intercambiables: tipografía con pareja de fuentes
   real, portada a sangre, tratamiento de avatar y botones con jerarquía (un CTA principal y el resto
   secundario). Hoy los 5 temas del catálogo varían sobre todo en color. Encaja en el alcance de temas
   de F2.5, ampliado.
3. **Jerarquía de conversión en la página pública:** el CTA principal (WhatsApp, reservar o
   cotizar) destacado arriba y fijo en móvil, en vez de una lista uniforme de botones. Es el punto
   14.2 del plan maestro (Smart CTA) en su versión mínima.
4. **Revisar la página pública contra la competencia en un teléfono real**, la única vista que
   importa en tráfico de Instagram/TikTok: tiempo de carga, tamaño de toque y contraste AA ya
   verificados.

Qué **no** hacer: copiar el look de Linktree o Beacons (fondos degradados, botones píldora
idénticos). La marca de Impulza es sobria y profesional (verde azulado profundo, bordes moderados)
y ese es el diferenciador visual para negocios, frente a la estética de creador.

## Fuentes

- [Linktree vs Beacons vs Stan vs QR-Verse (2026)](https://qr-verse.com/en/blog/linktree-vs-beacons-vs-stan-vs-qr-verse)
- [Linktree Pricing 2026 — elev8or](https://www.elev8or.io/blog/bio/linktree-pricing)
- [Stan Store vs Beacons (2026)](https://stan.store/blog/stan-store-vs-beacons/)
- [Beacons vs Linktree 2026 — Talkspresso](https://talkspresso.com/blog/beacons-vs-linktree-2026)
- [Linktree Reviews — Capterra](https://www.capterra.com/p/229171/Linktree/reviews/)
- [Linktree Custom Domain — Linkie](https://linkie.bio/blog/linktree-custom-domain)
- [Best Link in Bio Tools for Small Businesses 2026 — Findstack](https://findstack.com/software/link-in-bio-tools/s/small-business)
- [WhatsApp Penetration in Latin America 2026 — Mazkara](https://mazkara.studio/en/newsletter/whatsapp-penetration-latin-america-2026/)
- [WhatsApp Business API Chile 2026 — ChatDaddy](https://chatdaddy.tech/blog/whatsapp-business-api-chile)
