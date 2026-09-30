# ADR-018: Bloques con contenido externo (música, mapa, video vertical) y con tiempo (cuenta regresiva, eventos), en la lista cerrada del catálogo

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** F7.3 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.3 (bloques), ST §9 y §22 (catálogo
  cerrado, sin HTML libre), ADR-008 (página pública estilo enlace en bio), ADR-016 (CSP). Aprobado
  por el propietario al pedir continuar con F7.3.

## Contexto

Los negocios piden bloques que hoy no existen: una cuenta regresiva para un lanzamiento, una tabla
de precios, dónde están (mapa), su música y sus próximas fechas. Los tres primeros de contenido
externo (música, mapa, video de TikTok) son iframes de terceros: si se aceptara "pega el código de
inserción", el negocio podría meter cualquier HTML en su página pública, algo que el proyecto
prohíbe (ST §22). Los bloques con fecha tienen otro problema: la página se renderiza en el servidor
y se cachea, pero "faltan 3 días" o "este evento ya pasó" dependen del momento en que se mira.

## Decisión

1. **Contenido externo por plantilla fija, nunca código pegado.** Igual que el video (F2.4): el
   negocio pega el **enlace normal** de la canción, el lugar o el video; el servidor lo reconoce y
   guarda solo `{proveedor, tipo, id}` validado por lista blanca de caracteres; el render arma el
   `src` desde una plantilla fija por proveedor. Proveedores:
   - Música: **Spotify** (tema, álbum, lista, artista, episodio, programa), **SoundCloud** (usuario,
     tema o lista, por su ruta) y **Apple Music** (tema, álbum o lista, con país).
   - Video: se suman **TikTok** y el formato **vertical** (Shorts de YouTube y TikTok se ven 9:16).
2. **El mapa no carga nada de Google hasta que el visitante lo pide.** Se guarda la dirección (texto)
   y, opcionalmente, el nombre del lugar; no se geocodifica en el servidor (sería pedir URLs de
   terceros desde el servidor, y costo por clave). La página muestra una tarjeta propia con la
   dirección y los botones "Cómo llegar" (Google Maps y Waze, enlaces normales); "Ver mapa" carga el
   iframe de Google Maps en ese momento. Así la visita no comparte datos con Google solo por abrir la
   página, y la página pesa menos.
3. **Hora de pared más zona horaria** para cuenta regresiva y eventos (como las reservas, F5.1): se
   guarda `2026-10-12T20:00` + `America/Santiago` y se convierte con las funciones de zona ya
   probadas. El servidor renderiza la fecha escrita ("12 de octubre, 20:00"), que es correcta con o
   sin caché; el conteo segundo a segundo y el ocultar eventos pasados ocurren **en el navegador**
   después de hidratar (sin desajuste de hidratación), y los lectores de pantalla oyen la fecha, no
   cada segundo.
4. **Lista cerrada con topes:** precios hasta 4 planes (montos enteros en la unidad mínima, nunca
   decimales), 12 características por plan; eventos hasta 20; todo texto es plano. Cada nuevo tipo
   entra al catálogo con su esquema Zod y su versión, como cualquier bloque.
5. **CSP:** `frame-src` suma solo `open.spotify.com`, `w.soundcloud.com`, `embed.music.apple.com`,
   `www.tiktok.com` y `www.google.com` (mapa), con su prueba.
6. **Salud de página:** una cuenta regresiva terminada, o un bloque de eventos sin fechas futuras,
   aparece como hallazgo para que el negocio lo actualice.

## Alternativas consideradas

- **Aceptar el código de inserción ("embed") que dan las plataformas:** es HTML libre en la página
  pública (ST §22). Descartada.
- **Mapa con OpenStreetMap y coordenadas:** exigiría geocodificar la dirección (servicio externo desde
  el servidor, SSRF y límites de uso) o pedirle al negocio latitud y longitud. Queda como mejora si
  se contrata un geocodificador.
- **Filtrar eventos pasados en el servidor:** con la página cacheada, un evento se seguiría viendo
  hasta revalidar; en el navegador es exacto. El servidor igual los ordena.

## Consecuencias

- Positivas: cinco bloques nuevos sin abrir la puerta al HTML libre; el mapa respeta la privacidad
  del visitante por defecto.
- Negativas: un proveedor que cambie su formato de enlace o de inserción obliga a actualizar la
  plantilla (se cubre con pruebas por proveedor); SoundCloud usa la ruta pública, no un id numérico.
- Seguimiento: sumar un proveedor es agregar su analizador, plantilla, origen en la CSP y pruebas.

## Restricciones asociadas

- Nunca se guarda ni se renderiza una URL de iframe escrita por el usuario.
- Todo origen nuevo de iframe pasa por `apps/web/lib/security-headers.ts` con su prueba.
