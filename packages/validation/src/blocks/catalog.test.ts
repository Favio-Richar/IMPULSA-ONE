import { describe, expect, it } from "vitest";
import {
  BLOCK_CATALOG,
  BLOCK_TYPES,
  getBlockDefinition,
  isBlockType,
  isPrimaryActionBlockType,
  PRIMARY_ACTION_BLOCK_TYPES,
  socialSchema,
  testimonialsSchema,
  type BlockType,
} from "./catalog.js";
import { parseVideoUrl, safeUrlSchema } from "./primitives.js";
import { collectRichTextPaths } from "./rich-text-paths.js";
import { parseStoredBlock } from "./stored-block.js";

describe("catálogo de bloques (F2.4)", () => {
  it("cubre los 15 bloques del MVP de ST §9, reservas y tienda (F5) y los cinco de F7.3, sin repetir", () => {
    expect(BLOCK_TYPES).toHaveLength(23);
    expect(new Set(BLOCK_TYPES).size).toBe(23);
    for (const type of ["countdown", "pricing", "map", "music", "events"]) {
      expect(BLOCK_TYPES).toContain(type);
    }
    expect(BLOCK_TYPES).toContain("booking");
    expect(BLOCK_TYPES).toContain("catalog");
  });

  it("cada tipo tiene su entrada, con el mismo `type` que su clave y una versión válida", () => {
    for (const type of BLOCK_TYPES) {
      const definition = BLOCK_CATALOG[type];
      expect(definition.type).toBe(type);
      expect(Number.isInteger(definition.version)).toBe(true);
      expect(definition.version).toBeGreaterThanOrEqual(1);
    }
  });

  it("isBlockType / getBlockDefinition rechazan tipos fuera del catálogo", () => {
    expect(isBlockType("text")).toBe(true);
    expect(isBlockType("script")).toBe(false);
    expect(isBlockType("__proto__")).toBe(false);
    expect(getBlockDefinition("iframe")).toBeNull();
  });

  it("richTextPaths coincide exactamente con los campos marcados en el esquema", () => {
    // El olvido más peligroso posible en este módulo: agregar un campo de HTML del usuario y no
    // declararlo, con lo que nunca pasaría por el sanitizador del servidor y llegaría crudo a la
    // página pública. Acá no se confía en la declaración: se recorre el esquema de verdad y se
    // compara con lo declarado, en ambos sentidos.
    for (const type of BLOCK_TYPES) {
      const { schema, richTextPaths } = BLOCK_CATALOG[type];

      expect(
        collectRichTextPaths(schema),
        `${type}: los campos de texto enriquecido del esquema no coinciden con richTextPaths`,
      ).toEqual([...richTextPaths].sort());
    }
  });

  it("el recorrido del esquema encuentra texto enriquecido anidado dentro de listas", () => {
    // Si este recorrido fuera superficial, la prueba de arriba pasaría en falso para `faq`,
    // cuyo campo enriquecido vive dentro de un array de objetos.
    expect(collectRichTextPaths(BLOCK_CATALOG.faq.schema)).toEqual(["items[].answer"]);
    expect(collectRichTextPaths(BLOCK_CATALOG.profile.schema)).toEqual(["bio"]);
    expect(collectRichTextPaths(BLOCK_CATALOG.divider.schema)).toEqual([]);
  });

  it("lo que un esquema produce al guardar, el mismo esquema lo vuelve a aceptar al leer", () => {
    // Invariante de ida y vuelta. El mismo esquema valida la entrada del usuario y relee lo que
    // quedó guardado (parseStoredBlock), así que si alguno transforma la forma del dato —como el
    // bloque de video, que acepta una URL y guarda {provider, videoId}— y no acepta su propia
    // salida, TODOS los bloques de ese tipo quedarían marcados como inválidos al renderizar.
    const validSamples: Record<BlockType, unknown> = {
      profile: { name: "Ana", bio: "<p>hola</p>" },
      hero: { title: "Hola", cta: { label: "Ir", url: "https://ejemplo.cl" } },
      text: { html: "<p>hola</p>" },
      link: { label: "Ir", url: "https://ejemplo.cl" },
      social: { links: [{ network: "instagram", url: "https://instagram.com/x" }] },
      image: { image: { url: "https://cdn.ejemplo.cl/a.jpg", alt: "a" } },
      gallery: { images: [{ url: "https://cdn.ejemplo.cl/a.jpg", alt: "a" }] },
      video: { video: "https://youtu.be/dQw4w9WgXcQ" },
      whatsapp: { phone: "+56912345678" },
      contact_actions: { email: "a@b.cl" },
      contact_form: {},
      service: { name: "Asesoría", priceCurrency: "clp" },
      divider: {},
      faq: { items: [{ question: "¿?", answer: "<p>sí</p>" }] },
      testimonials: { items: [{ quote: "Bien", author: "Ana" }] },
      booking: { label: "Reservar hora" },
      catalog: { label: "Tienda" },
      countdown: { target: "2031-10-12T20:00", timeZone: "America/Santiago" },
      pricing: { plans: [{ name: "Básico", priceAmount: 9990, features: ["Una sesión"] }] },
      map: { address: "Av. Providencia 1234, Santiago" },
      music: { music: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" },
      events: { timeZone: "America/Santiago", items: [{ name: "Lanzamiento", start: "2031-11-01T19:00" }] },
      newsletter: { title: "Novedades" },
    };

    for (const type of BLOCK_TYPES) {
      const { schema, version } = BLOCK_CATALOG[type];

      const first = schema.safeParse(validSamples[type]);
      expect(first.success, `${type}: la muestra de prueba no es válida`).toBe(true);
      if (!first.success) continue;

      // Releer lo guardado debe dar exactamente lo mismo, y debe ser renderizable.
      const second = schema.safeParse(first.data);
      expect(second.success, `${type}: el esquema no acepta su propia salida`).toBe(true);
      if (second.success) {
        expect(second.data, `${type}: releer cambia el dato`).toEqual(first.data);
      }

      expect(
        parseStoredBlock(type, version, first.data).renderable,
        `${type}: lo guardado no se puede renderizar`,
      ).toBe(true);
    }
  });

  it("los tipos con texto enriquecido son los esperados (un cambio debe notarse)", () => {
    const withRichText = BLOCK_TYPES.filter((type) => BLOCK_CATALOG[type].richTextPaths.length > 0);
    expect([...withRichText].sort()).toEqual(["faq", "profile", "service", "text"]);
  });
});

describe("validación de enlaces", () => {
  it("acepta http y https", () => {
    expect(safeUrlSchema.safeParse("https://impulza.one/algo").success).toBe(true);
    expect(safeUrlSchema.safeParse("http://ejemplo.cl").success).toBe(true);
  });

  it("rechaza esquemas que son ejecución de código disfrazada de enlace", () => {
    const dangerous = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ];

    for (const value of dangerous) {
      expect(safeUrlSchema.safeParse(value).success, `debería rechazar: ${value}`).toBe(false);
    }
  });

  it("rechaza texto que no es una URL absoluta", () => {
    for (const value of ["/ruta-relativa", "no es una url", ""]) {
      expect(safeUrlSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("video embebido", () => {
  it("extrae el id de las formas habituales de YouTube y Vimeo", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
    });
  });

  it("rechaza cualquier proveedor fuera de la lista blanca", () => {
    const rejected = [
      "https://evil.example.com/embed/xyz",
      "https://youtube.evil.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://vimeo.com/no-es-un-id",
      "https://www.youtube.com/watch?v=corto",
    ];

    for (const value of rejected) {
      expect(parseVideoUrl(value), `debería rechazar: ${value}`).toBeNull();
    }
  });
});

describe("degradación controlada de bloques guardados (F2.4)", () => {
  it("un bloque válido es renderizable y devuelve su config ya parseada", () => {
    const result = parseStoredBlock("divider", 1, { style: "line", size: "lg" });

    expect(result.renderable).toBe(true);
    if (result.renderable) {
      expect(result.config).toMatchObject({ style: "line", size: "lg" });
    }
  });

  it("un tipo desconocido no rompe: se marca como no renderizable", () => {
    expect(parseStoredBlock("bloque_del_futuro", 1, {})).toEqual({
      renderable: false,
      reason: "unknown_type",
    });
  });

  it("una versión de esquema mayor a la conocida no se intenta interpretar", () => {
    expect(parseStoredBlock("divider", 99, { style: "line" })).toEqual({
      renderable: false,
      reason: "future_version",
    });
  });

  it("una configuración corrupta omite ese bloque, no la página entera", () => {
    expect(parseStoredBlock("link", 1, { label: "Sin URL" })).toEqual({
      renderable: false,
      reason: "invalid_config",
    });
  });

  it("un enlace guardado con javascript: deja de ser renderizable aunque ya esté en la base", () => {
    // Defensa en profundidad: si por cualquier vía entrara un enlace peligroso, el render lo
    // descarta igual en vez de confiar en que se validó al guardar.
    expect(parseStoredBlock("link", 1, { label: "Click", url: "javascript:alert(1)" })).toEqual({
      renderable: false,
      reason: "invalid_config",
    });
  });
});

describe("encabezado de perfil (PP4)", () => {
  const schema = BLOCK_CATALOG.profile.schema;
  const cover = { url: "https://cdn.example.com/portada.webp", alt: "Oficina frente al mar" };

  it("una configuración anterior, sin portada ni redes, sigue siendo válida sin cambios", () => {
    const stored = { name: "Ana", headline: "Abogada", verified: true };
    expect(parseStoredBlock("profile", 1, stored)).toEqual({ renderable: true, config: stored });
  });

  it("acepta portada y hasta 8 redes", () => {
    const socials = Array.from({ length: 8 }, (_, index) => ({
      network: "instagram",
      url: `https://instagram.com/ana${index}`,
    }));
    expect(schema.safeParse({ name: "Ana", cover, socials }).success).toBe(true);
    expect(schema.safeParse({ name: "Ana", cover, socials: [...socials, socials[0]] }).success).toBe(false);
  });

  it("rechaza una red desconocida o un enlace peligroso en la fila de redes", () => {
    expect(schema.safeParse({ name: "Ana", socials: [{ network: "myspace", url: "https://x.com" }] }).success).toBe(false);
    expect(
      schema.safeParse({ name: "Ana", socials: [{ network: "instagram", url: "javascript:alert(1)" }] }).success,
    ).toBe(false);
  });
});

describe("compartir (PL8)", () => {
  it("shareable y shareButton son opcionales: sin ellos, lo guardado se lee igual", () => {
    expect(parseStoredBlock("link", 1, { label: "A", url: "https://a.cl", style: "secondary" })).toEqual({
      renderable: true,
      config: { label: "A", url: "https://a.cl", style: "secondary" },
    });
    expect(BLOCK_CATALOG.link.schema.safeParse({ label: "A", url: "https://a.cl", shareable: true }).success).toBe(true);
    expect(BLOCK_CATALOG.profile.schema.safeParse({ name: "Ana", shareButton: "sí" }).success).toBe(false);
  });
});

describe("cabecera de cuerpo entero (PL7)", () => {
  it("acepta `layout` avatar o hero, rechaza otro valor, y sin él la configuración anterior no cambia", () => {
    const schema = BLOCK_CATALOG.profile.schema;
    expect(schema.safeParse({ name: "Ana", layout: "hero" }).success).toBe(true);
    expect(schema.safeParse({ name: "Ana", layout: "avatar" }).success).toBe(true);
    expect(schema.safeParse({ name: "Ana", layout: "banner" }).success).toBe(false);
    const stored = { name: "Ana", verified: false };
    expect(parseStoredBlock("profile", 1, stored)).toEqual({ renderable: true, config: stored });
  });
});

describe("reseñas como insignia (PL6)", () => {
  const schema = testimonialsSchema;
  const items = [{ quote: "Excelente", author: "Clienta" }];

  it("una configuración anterior, sin promedio, total ni enlace, sigue siendo válida sin cambios", () => {
    const stored = { title: "Reseñas", items };
    expect(parseStoredBlock("testimonials", 1, stored)).toEqual({ renderable: true, config: stored });
  });

  it("acepta promedio con un decimal, total entero y enlace seguro", () => {
    expect(schema.safeParse({ items, ratingAverage: 4.9, reviewCount: 128, reviewsUrl: "https://ejemplo.cl/r" }).success).toBe(true);
  });

  it("rechaza promedio fuera de 1–5 o con más de un decimal, total no entero y enlace peligroso", () => {
    expect(schema.safeParse({ items, ratingAverage: 5.5 }).success).toBe(false);
    expect(schema.safeParse({ items, ratingAverage: 4.95 }).success).toBe(false);
    expect(schema.safeParse({ items, reviewCount: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ items, reviewsUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("redes (ADR-008)", () => {
  it("sin estilo elegido, las redes son botones de la pila", () => {
    const parsed = socialSchema.parse({ links: [{ network: "instagram", url: "https://instagram.com/ana" }] });
    expect(parsed.style).toBe("buttons");
  });
});

describe("acción principal (PP5)", () => {
  it("solo los bloques que llevan a un contacto real pueden ser la acción principal", () => {
    expect([...PRIMARY_ACTION_BLOCK_TYPES].sort()).toEqual(["booking", "contact_form", "link", "whatsapp"]);
    for (const type of PRIMARY_ACTION_BLOCK_TYPES) {
      expect(isBlockType(type)).toBe(true);
    }
    for (const type of ["text", "profile", "gallery", "divider", "social"]) {
      expect(isPrimaryActionBlockType(type), type).toBe(false);
    }
  });
});
