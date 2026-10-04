import "./load-dotenv.js";
import { createAgencyClientRecords, maintainAgencyImports, processAgencyImport, type AgencyImportOptions } from "@impulza/agency";
import { generateVerificationToken, hashToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// F9.5d — el procesador de la importación de clientes contra la base real: crea cada cliente con su invitación y su acceso delegado, no
// duplica al reimportar, respeta el cupo del plan, tolera dos workers a la vez y se recupera de una caída a mitad.

const DAY_MS = 24 * 60 * 60 * 1000;

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error("proveedor caído");
    this.messages.push(message);
  }
}

describe("importación de clientes (F9.5d)", () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const emailDomain = `@imp-w-${suffix}.test`;
  let ownerRoleId: string;
  let sequence = 0;
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];

  const makeOptions = (email: RecordingEmail, overrides: Partial<AgencyImportOptions> = {}): AgencyImportOptions => ({
    email,
    appBaseUrl: "https://panel.impulza.test/",
    log: (event, data) => logs.push({ event, data }),
    ...overrides,
  });
  const slug = (label: string) => `imp-w-${suffix}-${label}-${(sequence += 1)}`;

  /** Una agencia con una persona dueña (que recibe el acceso delegado a cada cliente nuevo). */
  async function newAgency(kind: "AGENCY" | "BUSINESS" = "AGENCY") {
    const organization = await prisma.organization.create({ data: { name: "Agencia Importadora", slug: slug("agencia"), kind } });
    const user = await prisma.user.create({ data: { email: `agente-${sequence}${emailDomain}`, passwordHash: "x", emailVerifiedAt: new Date() } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: user.id, roleId: ownerRoleId, status: "ACTIVE" } });
    return { organization, user };
  }

  async function newImport(agency: Awaited<ReturnType<typeof newAgency>>, rows: Array<{ name?: string; slug?: string; ownerEmail?: string; billingMode?: "CLIENT_PAYS" | "AGENCY_PAYS" }>, clientsLimit: number | null = null) {
    return prisma.agencyImport.create({
      data: {
        agencyOrganizationId: agency.organization.id,
        createdById: agency.user.id,
        totalRows: rows.length,
        clientsLimit,
        rows: {
          create: rows.map((row, index) => ({
            rowNumber: index + 1,
            name: row.name ?? `Cliente ${index + 1}`,
            slug: row.slug ?? slug(`c${index + 1}`),
            ownerEmail: row.ownerEmail ?? `dueno-${sequence}-${index}${emailDomain}`,
            billingMode: row.billingMode ?? "CLIENT_PAYS",
          })),
        },
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
  }

  const reload = (id: string) => prisma.agencyImport.findUniqueOrThrow({ where: { id }, include: { rows: { orderBy: { rowNumber: "asc" } } } });

  beforeAll(async () => {
    ownerRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } })).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: `imp-w-${suffix}` } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: emailDomain } } });
    await prisma.$disconnect();
  });

  it("crea cada cliente con su organización, relación, invitación al propietario, acceso delegado y auditoría", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const job = await newImport(agency, [
      { name: "Café del Sol", slug: slug("cafe"), ownerEmail: `cafe${emailDomain}` },
      { name: "Taller Boreal", slug: slug("taller"), ownerEmail: `taller${emailDomain}`, billingMode: "AGENCY_PAYS" },
    ]);

    const result = await processAgencyImport(prisma, job.id, makeOptions(email));
    expect(result.processed).toBe(2);

    const done = await reload(job.id);
    expect(done).toMatchObject({ status: "COMPLETED", processedRows: 2, createdRows: 2, existedRows: 0, errorRows: 0 });
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.rows.map((row) => row.status)).toEqual(["CREATED", "CREATED"]);

    for (const row of done.rows) {
      const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: row.slug } });
      expect(organization).toMatchObject({ name: row.name, kind: "BUSINESS", status: "ACTIVE" });
      expect(row.clientOrganizationId).toBe(organization.id);
      const relation = await prisma.agencyClient.findFirstOrThrow({ where: { clientOrganizationId: organization.id } });
      expect(relation).toMatchObject({ agencyOrganizationId: agency.organization.id, status: "INVITED", agencyCreated: true, ownerInviteEmail: row.ownerEmail, billingMode: row.billingMode, requestedById: agency.user.id });
      expect(relation.ownerInviteTokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(relation.ownerInviteExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);
      // La agencia entra desde el primer día, con el rol delegado y a nombre de la persona.
      const membership = await prisma.membership.findFirstOrThrow({ where: { organizationId: organization.id, userId: agency.user.id }, include: { role: true } });
      expect(membership).toMatchObject({ status: "ACTIVE", source: "AGENCY", agencyClientId: relation.id });
      expect(membership.role.name).toBe("AGENCY_DELEGATE");
      // Auditoría en la agencia y en el cliente, con la importación de origen.
      const inAgency = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: agency.organization.id, action: "agency.client.created", targetId: relation.id } });
      expect(inAgency.metadata).toMatchObject({ clientOrganizationId: organization.id, importId: job.id });
      expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: "agency.link.created" } })).toBe(1);
    }

    // La invitación sale a cada propietario, con un enlace al panel y el token de ESA relación (nunca la huella).
    expect(email.messages).toHaveLength(2);
    const cafe = email.messages.find((message) => message.to === `cafe${emailDomain}`)!;
    expect(cafe.subject).toBe("Agencia Importadora te invita a administrar «Café del Sol» — Impulza One");
    const token = /token=([A-Za-z0-9_-]+)/.exec(cafe.text)?.[1];
    expect(token).toBeTruthy();
    expect(cafe.text).toContain("https://panel.impulza.test/invitaciones/agencia?token=");
    expect(cafe.text).not.toContain("//invitaciones");
    const cafeRelation = await prisma.agencyClient.findFirstOrThrow({ where: { ownerInviteEmail: `cafe${emailDomain}`, agencyOrganizationId: agency.organization.id } });
    expect(cafeRelation.ownerInviteTokenHash).toBe(hashToken(token!));
  });

  it("reimportar no duplica: las filas cuyo cliente ya existe (mismo identificador y correo) quedan como tales, sin otra invitación", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const rows = [
      { name: "Uno", slug: slug("uno"), ownerEmail: `uno${emailDomain}` },
      { name: "Dos", slug: slug("dos"), ownerEmail: `dos${emailDomain}` },
    ];
    const first = await newImport(agency, rows);
    await processAgencyImport(prisma, first.id, makeOptions(email));
    expect(email.messages).toHaveLength(2);

    // Procesar otra vez la misma importación terminada no hace nada.
    expect((await processAgencyImport(prisma, first.id, makeOptions(email))).processed).toBe(0);

    // El mismo archivo subido de nuevo (otra importación): todo «ya existía».
    const second = await newImport(agency, rows);
    await processAgencyImport(prisma, second.id, makeOptions(email));
    const again = await reload(second.id);
    expect(again).toMatchObject({ status: "COMPLETED", createdRows: 0, existedRows: 2, errorRows: 0 });
    expect(again.rows.map((row) => row.status)).toEqual(["EXISTED", "EXISTED"]);
    const firstRows = (await reload(first.id)).rows;
    expect(again.rows.map((row) => row.clientOrganizationId)).toEqual(firstRows.map((row) => row.clientOrganizationId));
    expect(email.messages).toHaveLength(2);
    expect(await prisma.organization.count({ where: { slug: { in: rows.map((row) => row.slug) } } })).toBe(2);
    expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.organization.id } })).toBe(2);
  });

  it("un identificador que ya usa otro negocio, o un cliente propio con otro correo o ya terminado, es un error de esa fila y no frena a las demás", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const stranger = await prisma.organization.create({ data: { name: "Ajeno", slug: slug("ajeno") } });
    // Un cliente propio, creado antes con otro correo.
    const own = await prisma.$transaction((tx) => {
      const { raw, hash } = generateVerificationToken();
      void raw;
      return createAgencyClientRecords(tx, { agencyOrganizationId: agency.organization.id, actorId: agency.user.id, name: "Propio", slug: slug("propio"), ownerEmail: `otro${emailDomain}`, billingMode: "CLIENT_PAYS", inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + DAY_MS) });
    });
    // Otro, que la agencia soltó (relación terminada): su organización sigue existiendo.
    const released = await prisma.$transaction((tx) => {
      const { hash } = generateVerificationToken();
      return createAgencyClientRecords(tx, { agencyOrganizationId: agency.organization.id, actorId: agency.user.id, name: "Soltado", slug: slug("soltado"), ownerEmail: `soltado${emailDomain}`, billingMode: "CLIENT_PAYS", inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + DAY_MS) });
    });
    await prisma.agencyClient.update({ where: { id: released.relation.id }, data: { status: "ENDED", endedAt: new Date() } });

    const job = await newImport(agency, [
      { slug: stranger.slug, ownerEmail: `a${emailDomain}` },
      { slug: own.organization.slug, ownerEmail: `distinto${emailDomain}` },
      { slug: released.organization.slug, ownerEmail: `soltado${emailDomain}` },
      { name: "Sí entra", slug: slug("entra"), ownerEmail: `entra${emailDomain}` },
    ]);
    await processAgencyImport(prisma, job.id, makeOptions(email));
    const done = await reload(job.id);
    expect(done.rows.map((row) => [row.status, row.errorCode])).toEqual([["ERROR", "SLUG_TAKEN"], ["ERROR", "SLUG_TAKEN"], ["ERROR", "SLUG_TAKEN"], ["CREATED", null]]);
    expect(done.rows[0]?.errorMessage).toContain("ya está en uso");
    expect(done).toMatchObject({ status: "COMPLETED", processedRows: 4, createdRows: 1, errorRows: 3 });
    expect(email.messages).toHaveLength(1);
    // Nada del ajeno cambió.
    expect(await prisma.agencyClient.count({ where: { clientOrganizationId: stranger.id } })).toBe(0);
  });

  it("respeta el cupo de clientes del plan: las filas que ya no caben quedan con error y no se pierden en silencio", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    // Ya tiene un cliente; el plan permite 3 en total → caben 2 más.
    await prisma.$transaction((tx) => createAgencyClientRecords(tx, { agencyOrganizationId: agency.organization.id, actorId: agency.user.id, name: "Previo", slug: slug("previo"), ownerEmail: `previo${emailDomain}`, billingMode: "CLIENT_PAYS", inviteTokenHash: generateVerificationToken().hash, inviteExpiresAt: new Date(Date.now() + DAY_MS) }));
    const job = await newImport(agency, [{}, {}, {}, {}], 3);
    await processAgencyImport(prisma, job.id, makeOptions(email));
    const done = await reload(job.id);
    expect(done.rows.map((row) => row.status)).toEqual(["CREATED", "CREATED", "ERROR", "ERROR"]);
    expect(done.rows[2]).toMatchObject({ errorCode: "NO_QUOTA" });
    expect(done.rows[2]?.errorMessage).toContain("cupo de clientes");
    expect(done).toMatchObject({ status: "COMPLETED", createdRows: 2, errorRows: 2, processedRows: 4 });
    expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.organization.id, status: { not: "ENDED" } } })).toBe(3);
    expect(email.messages).toHaveLength(2);

    // Sin tope no hay límite.
    const unlimited = await newImport(agency, [{}, {}, {}], null);
    await processAgencyImport(prisma, unlimited.id, makeOptions(email));
    expect((await reload(unlimited.id)).createdRows).toBe(3);
  });

  it("un cliente que se suelta libera cupo: el mismo tope deja pasar una fila más", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const first = await newImport(agency, [{}, {}], 2);
    await processAgencyImport(prisma, first.id, makeOptions(email));
    const blocked = await newImport(agency, [{}], 2);
    await processAgencyImport(prisma, blocked.id, makeOptions(email));
    expect((await reload(blocked.id)).rows[0]).toMatchObject({ status: "ERROR", errorCode: "NO_QUOTA" });
    await prisma.agencyClient.updateMany({ where: { agencyOrganizationId: agency.organization.id }, data: { status: "ENDED", endedAt: new Date() } });
    const again = await newImport(agency, [{}], 2);
    await processAgencyImport(prisma, again.id, makeOptions(email));
    expect((await reload(again.id)).rows[0]?.status).toBe("CREATED");
  });

  it("un fallo del proveedor de correo no deshace el alta: el cliente queda creado y se avisa en el registro", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    email.fail = true;
    const before = logs.length;
    const job = await newImport(agency, [{ slug: slug("sincorreo") }]);
    await processAgencyImport(prisma, job.id, makeOptions(email));
    const done = await reload(job.id);
    expect(done.rows[0]?.status).toBe("CREATED");
    expect(await prisma.organization.count({ where: { slug: done.rows[0]!.slug } })).toBe(1);
    expect(logs.slice(before).some((entry) => entry.event === "agency.import.email_failed")).toBe(true);
  });

  it("dos workers a la vez sobre la misma importación crean cada cliente UNA sola vez", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const job = await newImport(agency, Array.from({ length: 12 }, () => ({})));
    const [a, b] = await Promise.all([processAgencyImport(prisma, job.id, makeOptions(email)), processAgencyImport(prisma, job.id, makeOptions(email))]);
    expect(a.processed + b.processed).toBe(12);
    const done = await reload(job.id);
    expect(done).toMatchObject({ status: "COMPLETED", processedRows: 12, createdRows: 12, errorRows: 0 });
    expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.organization.id } })).toBe(12);
    expect(email.messages).toHaveLength(12);
    expect(new Set(email.messages.map((message) => message.to)).size).toBe(12);
  });

  it("se recupera de una caída a mitad: una fila colgada vuelve a la cola y, si el cliente ya se había creado, queda como existente (sin duplicar)", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const job = await newImport(agency, [{ name: "Quedó a medias", slug: slug("medias"), ownerEmail: `medias${emailDomain}` }, { name: "Nunca empezó", slug: slug("nunca") }]);
    const [crashed, untouched] = job.rows;
    // El worker murió justo después de crear el cliente y antes de anotarlo en la fila.
    await prisma.$transaction((tx) => createAgencyClientRecords(tx, { agencyOrganizationId: agency.organization.id, actorId: agency.user.id, name: crashed!.name, slug: crashed!.slug, ownerEmail: crashed!.ownerEmail, billingMode: "CLIENT_PAYS", inviteTokenHash: generateVerificationToken().hash, inviteExpiresAt: new Date(Date.now() + DAY_MS) }));
    await prisma.agencyImportRow.update({ where: { id: crashed!.id }, data: { status: "PROCESSING", updatedAt: new Date(Date.now() - 10 * 60_000) } });
    // Una fila en proceso reciente (de un worker vivo) NO se toca.
    await prisma.agencyImportRow.update({ where: { id: untouched!.id }, data: { status: "PROCESSING" } });

    await processAgencyImport(prisma, job.id, makeOptions(email));
    const mid = await reload(job.id);
    expect(mid.rows[0]).toMatchObject({ status: "EXISTED" });
    expect(mid.rows[1]?.status).toBe("PROCESSING");
    expect(mid.status).toBe("RUNNING");
    expect(await prisma.organization.count({ where: { slug: crashed!.slug } })).toBe(1);

    // Cuando esa fila también queda colgada, se retoma y la importación termina.
    await prisma.agencyImportRow.update({ where: { id: untouched!.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    await processAgencyImport(prisma, job.id, makeOptions(email));
    expect(await reload(job.id)).toMatchObject({ status: "COMPLETED", processedRows: 2, createdRows: 1, existedRows: 1 });
  });

  it("si la organización ya no es una agencia, no crea nada: las filas quedan con error", async () => {
    const agency = await newAgency("BUSINESS");
    const email = new RecordingEmail();
    const job = await newImport(agency, [{ slug: slug("noagencia") }]);
    await processAgencyImport(prisma, job.id, makeOptions(email));
    const done = await reload(job.id);
    expect(done.rows[0]).toMatchObject({ status: "ERROR", errorCode: "FAILED" });
    expect(done.rows[0]?.errorMessage).toContain("ya no es una agencia");
    expect(await prisma.organization.count({ where: { slug: done.rows[0]!.slug } })).toBe(0);
    expect(email.messages).toHaveLength(0);
  });

  it("una importación que no existe o ya terminó no hace nada", async () => {
    const email = new RecordingEmail();
    expect(await processAgencyImport(prisma, "00000000-0000-4000-8000-000000000000", makeOptions(email))).toEqual({ processed: 0 });
  });

  it("el mantenimiento retoma las importaciones sin avance, deja las recientes y borra las viejas (correos de terceros)", async () => {
    const agency = await newAgency();
    const email = new RecordingEmail();
    const stale = await newImport(agency, [{}]);
    const fresh = await newImport(agency, [{}]);
    await prisma.agencyImport.update({ where: { id: stale.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });

    const old = await newImport(agency, [{}]);
    await prisma.agencyImport.update({ where: { id: old.id }, data: { status: "COMPLETED", finishedAt: new Date(Date.now() - 61 * DAY_MS), processedRows: 1, createdRows: 1 } });
    await prisma.agencyImportRow.updateMany({ where: { importId: old.id }, data: { status: "CREATED" } });
    const recent = await newImport(agency, [{}]);
    await prisma.agencyImport.update({ where: { id: recent.id }, data: { status: "COMPLETED", finishedAt: new Date(Date.now() - 5 * DAY_MS), processedRows: 1, createdRows: 1 } });

    const result = await maintainAgencyImports(prisma, makeOptions(email));
    expect(result.resumed).toBeGreaterThanOrEqual(1);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect((await reload(stale.id)).status).toBe("COMPLETED");
    expect((await reload(fresh.id)).status).toBe("QUEUED");
    expect(await prisma.agencyImport.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.agencyImportRow.count({ where: { importId: old.id } })).toBe(0);
    expect(await prisma.agencyImport.count({ where: { id: recent.id } })).toBe(1);
  });

  it("el avance nunca se descuadra: lo procesado es la suma de sus resultados y no pasa del total (la base lo exige)", async () => {
    const agency = await newAgency();
    const job = await newImport(agency, [{}, {}]);
    await expect(prisma.agencyImport.update({ where: { id: job.id }, data: { processedRows: 5 } })).rejects.toThrow();
    await expect(prisma.agencyImport.update({ where: { id: job.id }, data: { processedRows: 1, createdRows: 0 } })).rejects.toThrow();
    await expect(prisma.agencyImport.update({ where: { id: job.id }, data: { createdRows: -1, processedRows: -1 } })).rejects.toThrow();
  });
});
