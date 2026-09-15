import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "./index.js";

// F2.1 — invariantes del modelo de datos de Fase 2 verificados contra el Postgres real, no contra
// el schema.prisma. Lo que se prueba acá es lo que la *base de datos* garantiza aunque la capa de
// aplicación tenga un bug: unicidad de slugs, numeración de versiones y borrado en cascada.
// Las reglas que sí viven en la aplicación (slugs reservados, colisión entre slug y redirección)
// se prueban en F2.2, donde se implementan.

const TEST_PREFIX = "f21-schema-test";

async function cleanup(): Promise<void> {
  // Las organizaciones borran en cascada sites -> pages -> blocks/versions y themes propios.
  await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
  await prisma.theme.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

describe("Esquema de sitios, páginas y bloques (F2.1)", () => {
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    await cleanup();

    const [org, other] = await Promise.all([
      prisma.organization.create({ data: { name: "Org F2.1", slug: `${TEST_PREFIX}-a` } }),
      prisma.organization.create({ data: { name: "Org F2.1 B", slug: `${TEST_PREFIX}-b` } }),
    ]);
    organizationId = org.id;
    otherOrganizationId = other.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("el slug de sitio es único de forma global, incluso entre organizaciones distintas", async () => {
    const slug = `${TEST_PREFIX}-sitio-unico`;
    await prisma.site.create({ data: { organizationId, name: "Sitio A", slug } });

    // Mismo slug, otra organización: debe fallar igual — el slug es la identidad pública.
    await expect(
      prisma.site.create({ data: { organizationId: otherOrganizationId, name: "Sitio B", slug } }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("el slug de página es único dentro del sitio pero se puede repetir entre sitios", async () => {
    const [siteA, siteB] = await Promise.all([
      prisma.site.create({ data: { organizationId, name: "A", slug: `${TEST_PREFIX}-pag-a` } }),
      prisma.site.create({ data: { organizationId, name: "B", slug: `${TEST_PREFIX}-pag-b` } }),
    ]);

    await prisma.page.create({ data: { siteId: siteA.id, slug: "contacto", position: 0 } });

    // Mismo slug en otro sitio: permitido.
    await expect(
      prisma.page.create({ data: { siteId: siteB.id, slug: "contacto", position: 0 } }),
    ).resolves.toBeTruthy();

    // Mismo slug en el mismo sitio: rechazado por la base de datos.
    await expect(
      prisma.page.create({ data: { siteId: siteA.id, slug: "contacto", position: 1 } }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("no se puede repetir el número de versión de una misma página", async () => {
    const site = await prisma.site.create({
      data: { organizationId, name: "Versiones", slug: `${TEST_PREFIX}-versiones` },
    });
    const page = await prisma.page.create({ data: { siteId: site.id, slug: "inicio", position: 0, isHome: true } });

    await prisma.pageVersion.create({
      data: { pageId: page.id, versionNumber: 1, contentSnapshot: { blocks: [] } },
    });

    await expect(
      prisma.pageVersion.create({
        data: { pageId: page.id, versionNumber: 1, contentSnapshot: { blocks: [] } },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("dos páginas del mismo sitio pueden compartir posición (reordenar no debe chocar)", async () => {
    const site = await prisma.site.create({
      data: { organizationId, name: "Orden", slug: `${TEST_PREFIX}-orden` },
    });

    await prisma.page.create({ data: { siteId: site.id, slug: "uno", position: 0 } });

    // Estado transitorio legítimo mientras se intercambian posiciones dentro de una transacción.
    await expect(
      prisma.page.create({ data: { siteId: site.id, slug: "dos", position: 0 } }),
    ).resolves.toBeTruthy();
  });

  it("borrar una organización arrastra sitios, páginas, bloques y versiones (sin huérfanos)", async () => {
    const org = await prisma.organization.create({
      data: { name: "Cascada", slug: `${TEST_PREFIX}-cascada` },
    });
    const site = await prisma.site.create({
      data: { organizationId: org.id, name: "Cascada", slug: `${TEST_PREFIX}-cascada-sitio` },
    });
    const page = await prisma.page.create({ data: { siteId: site.id, slug: "inicio", position: 0, isHome: true } });
    const block = await prisma.block.create({ data: { pageId: page.id, type: "text", position: 0 } });
    await prisma.blockVersion.create({ data: { blockId: block.id, versionNumber: 1, config: { text: "hola" } } });
    await prisma.pageVersion.create({
      data: { pageId: page.id, versionNumber: 1, contentSnapshot: { blocks: [] } },
    });
    await prisma.siteSlugRedirect.create({ data: { siteId: site.id, fromSlug: `${TEST_PREFIX}-viejo` } });

    await prisma.organization.delete({ where: { id: org.id } });

    expect(await prisma.site.count({ where: { id: site.id } })).toBe(0);
    expect(await prisma.page.count({ where: { id: page.id } })).toBe(0);
    expect(await prisma.block.count({ where: { id: block.id } })).toBe(0);
    expect(await prisma.blockVersion.count({ where: { blockId: block.id } })).toBe(0);
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
    expect(await prisma.siteSlugRedirect.count({ where: { siteId: site.id } })).toBe(0);
  });

  it("borrar el tema no borra el sitio: queda sin tema (SetNull), no huérfano", async () => {
    const theme = await prisma.theme.create({
      data: { code: `${TEST_PREFIX}-tema`, name: "Tema de prueba", tokens: { palette: "claro" } },
    });
    const site = await prisma.site.create({
      data: { organizationId, name: "Con tema", slug: `${TEST_PREFIX}-con-tema`, themeId: theme.id },
    });

    await prisma.theme.delete({ where: { id: theme.id } });

    const reloaded = await prisma.site.findUnique({ where: { id: site.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded?.themeId).toBeNull();
  });

  it("el código de tema del catálogo es único, pero varios temas propios pueden dejarlo en null", async () => {
    await prisma.theme.create({
      data: { code: `${TEST_PREFIX}-catalogo`, name: "Catálogo", tokens: {} },
    });

    await expect(
      prisma.theme.create({ data: { code: `${TEST_PREFIX}-catalogo`, name: "Duplicado", tokens: {} } }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );

    // Dos temas propios de organización sin código conviven sin problema (NULL no colisiona).
    await prisma.theme.create({ data: { organizationId, name: "Propio 1", tokens: {} } });
    await expect(
      prisma.theme.create({ data: { organizationId, name: "Propio 2", tokens: {} } }),
    ).resolves.toBeTruthy();
  });
});
