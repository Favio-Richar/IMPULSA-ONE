import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AGENCY_IMPORT_QUEUE, processAgencyImport, type AgencyImportJob } from "@impulza/agency";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyImportDetailResponse, agencyImportListResponse, agencyImportSummary } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { AGENCY_IMPORT_MAX_ROWS, parseCsv } from "@impulza/validation";
import { Queue, Worker } from "bullmq";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { AGENCY_IMPORT_QUEUE_TOKEN } from "./agency.tokens.js";

// F9.5d (ADR-028 §2) — importar clientes por CSV. La API valida el archivo fila por fila y encola; un worker real de BullMQ consume la cola y
// crea los clientes; el progreso se consulta. Reimportar no duplica, se respeta el cupo del plan y nada se mezcla entre agencias.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const EMAIL_DOMAIN = "@agency-import-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const HEADER = "nombre;identificador;correo_del_propietario;quien_paga";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Importar clientes por CSV (e2e) — F9.5d / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let queue: Queue<AgencyImportJob>;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  let worker: Worker<AgencyImportJob> | null = null;

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    queue = app.get(AGENCY_IMPORT_QUEUE_TOKEN);
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await worker?.close();
    await queue.obliterate({ force: true });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: EMAIL_DOMAIN } } } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "imp-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: "imp-e2e-plan" } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  // ---- ayudas -----------------------------------------------------------------------------------------------------

  /** Un consumidor REAL de la cola, igual al del worker de producción (misma lógica, misma cola). */
  function startWorker(): void {
    worker = new Worker<AgencyImportJob>(
      AGENCY_IMPORT_QUEUE,
      (job) => processAgencyImport(prisma, job.data.importId, { email: emailAdapter, appBaseUrl: "http://localhost:3100" }),
      { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null }, concurrency: 1 },
    );
  }
  async function stopWorker(): Promise<void> {
    await worker?.close();
    worker = null;
  }

  async function newUser(label = "u"): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function newAgency(clientsLimit?: number) {
    const owner = await newUser("agency-owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Importadora", slug: unique("imp-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    if (clientsLimit !== undefined) {
      const base = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
      const plan = await prisma.plan.create({ data: { code: unique("imp-e2e-plan"), name: "Agencia justa", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as Record<string, unknown>), clients: clientsLimit } } });
      await prisma.organization.update({ where: { id: agencyId }, data: { planId: plan.id } });
    }
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency/clients` };
  }
  type Agency = Awaited<ReturnType<typeof newAgency>>;

  const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n");
  const row = (label: string, owner = `${unique("dueno")}${EMAIL_DOMAIN}`, extra = "") => `Cliente ${label};${unique("imp-e2e-c")};${owner};${extra}`;
  const upload = (agency: Agency, text: string, fileName = "clientes.csv") => agency.agent.post(`${agency.base}/import`).set(CSRF).send({ csv: text, fileName });
  const summaryOf = (res: { body: unknown }) => agencyImportSummary.parse(res.body);
  const detail = async (agency: Agency, id: string, query = "") => agencyImportDetailResponse.parse((await agency.agent.get(`${agency.base}/imports/${id}${query}`).expect(200)).body);

  /** Espera a que el worker termine (el avance se consulta como lo haría la pantalla). */
  async function waitUntilDone(agency: Agency, id: string, timeoutMs = 20_000) {
    const started = Date.now();
    for (;;) {
      const current = await detail(agency, id, "?pageSize=100");
      if (current.import.status === "COMPLETED") return current;
      if (Date.now() - started > timeoutMs) throw new Error(`La importación no terminó: ${JSON.stringify(current.import)}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  // ---- plantilla --------------------------------------------------------------------------------------------------

  describe("plantilla descargable", () => {
    it("es un CSV (UTF-8 con BOM) que se descarga, que se vuelve a leer y cuyos ejemplos son válidos", async () => {
      const agency = await newAgency();
      const res = await agency.agent.get(`${agency.base}/import/template`).expect(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text.startsWith("\uFEFF")).toBe(true);
      const parsed = parseCsv(res.text);
      expect(parsed.ok && parsed.rows[0]).toEqual(["nombre", "identificador", "correo_del_propietario", "quien_paga"]);
      // Los ejemplos de la plantilla se pueden subir tal cual.
      const uploaded = summaryOf(await upload(agency, res.text).expect(201));
      expect(uploaded).toMatchObject({ totalRows: 2, errorRows: 0 });
    });
  });

  // ---- subir el archivo ---------------------------------------------------------------------------------------------

  describe("subir el archivo", () => {
    it("valida todo en el servidor, guarda cada fila y encola el trabajo sin crear ningún cliente todavía", async () => {
      const agency = await newAgency();
      const summary = summaryOf(await upload(agency, csv(row("uno"), row("dos"), row("tres", undefined, "agencia"))).expect(201));
      expect(summary).toMatchObject({ status: "QUEUED", fileName: "clientes.csv", totalRows: 3, processedRows: 0, createdRows: 0, errorRows: 0, startedAt: null, finishedAt: null });
      // Subir no crea clientes: eso lo hace el worker.
      expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(0);
      // El trabajo quedó en la cola con la importación como identificador (encolarla dos veces no la procesa dos veces).
      const job = await queue.getJob(summary.id);
      expect(job?.data).toEqual({ importId: summary.id });
      expect(await prisma.agencyImportRow.count({ where: { importId: summary.id, status: "PENDING" } })).toBe(3);
      await prisma.agencyImport.deleteMany({ where: { agencyOrganizationId: agency.agencyId } });
      await queue.obliterate({ force: true });
    });

    it("un worker real consume la cola, crea los clientes con su invitación y acceso, y el avance se ve al consultarlo", async () => {
      const agency = await newAgency();
      const owners = [`a-${unique("o")}${EMAIL_DOMAIN}`, `b-${unique("o")}${EMAIL_DOMAIN}`, `c-${unique("o")}${EMAIL_DOMAIN}`];
      const summary = summaryOf(await upload(agency, csv(row("uno", owners[0]), row("dos", owners[1]), row("tres", owners[2], "agencia"))).expect(201));
      startWorker();
      try {
        const done = await waitUntilDone(agency, summary.id);
        expect(done.import).toMatchObject({ status: "COMPLETED", totalRows: 3, processedRows: 3, createdRows: 3, existedRows: 0, errorRows: 0 });
        expect(done.import.startedAt).not.toBeNull();
        expect(done.import.finishedAt).not.toBeNull();
        expect(done.rows.items.map((item) => item.status)).toEqual(["CREATED", "CREATED", "CREATED"]);
        expect(done.rows.items[2]?.billingMode).toBe("AGENCY_PAYS");

        // Cada cliente es un alta normal: aparece en el panel, la agencia entra y el propietario recibe su invitación.
        const clients = (await agency.agent.get(agency.base).expect(200)).body as Array<{ clientOrganizationId: string; ownerInviteEmail: string; status: string; agencyCreated: boolean }>;
        expect(clients).toHaveLength(3);
        expect(clients.every((client) => client.status === "INVITED" && client.agencyCreated)).toBe(true);
        for (const client of clients) await agency.agent.get(`/api/v1/organizations/${client.clientOrganizationId}/sites`).expect(200);
        expect(emailAdapter.messages.filter((message) => owners.includes(message.to) && message.subject.includes("te invita a administrar"))).toHaveLength(3);
        expect(await prisma.auditLog.count({ where: { organizationId: agency.agencyId, action: "agency.client.created" } })).toBe(3);
        // Y aparece en las importaciones recientes.
        const list = agencyImportListResponse.parse((await agency.agent.get(`${agency.base}/imports`).expect(200)).body);
        expect(list.items[0]).toMatchObject({ id: summary.id, status: "COMPLETED" });
      } finally {
        await stopWorker();
      }
    });

    it("un error en una fila no frena a las demás: cada una dice SU problema, con la línea del archivo", async () => {
      const agency = await newAgency();
      const text = csv(row("bien"), "Slug malo;NO VALIDO;ok@ok.cl;", row("otra bien"), "Correo malo;correo-malo-x;no-es-correo;", "Paga raro;paga-raro-x;a@b.cl;gratis", "x;nombre-corto;a@b.cl;");
      const summary = summaryOf(await upload(agency, text).expect(201));
      // Las filas inválidas ya están contadas al subir, antes de que el worker toque nada.
      expect(summary).toMatchObject({ status: "QUEUED", totalRows: 6, processedRows: 4, errorRows: 4 });
      startWorker();
      try {
        const done = await waitUntilDone(agency, summary.id);
        expect(done.import).toMatchObject({ status: "COMPLETED", processedRows: 6, createdRows: 2, errorRows: 4 });
        expect(done.rows.items.map((item) => item.errorCode)).toEqual([null, "INVALID_SLUG", null, "INVALID_EMAIL", "INVALID_BILLING", "INVALID_NAME"]);
        const errorsOnly = await detail(agency, summary.id, "?onlyErrors=true");
        expect(errorsOnly.rows).toMatchObject({ total: 4 });
        expect(errorsOnly.rows.items.map((item) => item.rowNumber)).toEqual([2, 4, 5, 6]);
        expect(errorsOnly.rows.items[0]?.errorMessage).toContain("identificador");
      } finally {
        await stopWorker();
      }
    });

    it("sin ninguna fila válida nace terminada: no se encola nada", async () => {
      const agency = await newAgency();
      const summary = summaryOf(await upload(agency, csv("x;a;mal;", "y;b;mal;")).expect(201));
      expect(summary).toMatchObject({ status: "COMPLETED", totalRows: 2, processedRows: 2, errorRows: 2 });
      expect(summary.finishedAt).not.toBeNull();
      expect(await queue.getJob(summary.id)).toBeUndefined();
    });

    it("rechaza el archivo entero, sin crear nada, si no sirve: vacío, sin las columnas, sin filas, con comillas abiertas o con demasiadas filas", async () => {
      const agency = await newAgency();
      const tooMany = csv(...Array.from({ length: AGENCY_IMPORT_MAX_ROWS + 1 }, (_, index) => `C${index};imp-e2e-m-${index}-${Date.now()};a${index}@b.cl;`));
      for (const [label, text] of [
        ["vacío", "   \n  "],
        ["sin columnas", "telefono;direccion\n1;2"],
        ["sin filas", HEADER],
        ["comillas abiertas", `${HEADER}\n"abierta;x;y;`],
        ["demasiadas filas", tooMany],
      ] as const) {
        const res = await upload(agency, text);
        expect(res.status, label).toBe(400);
        expect(res.body.code, label).toBe("INVALID_IMPORT_FILE");
        expect(res.body.message, label).toBeTruthy();
        const keys = await redis.keys("ratelimit:*");
        if (keys.length > 0) await redis.del(...keys);
      }
      expect((await upload(agency, tooMany)).body.message).toContain(`el máximo es ${AGENCY_IMPORT_MAX_ROWS}`);
      expect(await prisma.agencyImport.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(0);
    });

    it("rechaza un cuerpo inválido (sin archivo, demasiado grande) con un mensaje claro", async () => {
      const agency = await newAgency();
      await agency.agent.post(`${agency.base}/import`).set(CSRF).send({}).expect(400);
      await agency.agent.post(`${agency.base}/import`).set(CSRF).send({ csv: "" }).expect(400);
      const big = await agency.agent.post(`${agency.base}/import`).set(CSRF).send({ csv: "x".repeat(45_001) }).expect(400);
      expect(JSON.stringify(big.body)).toContain("demasiado grande");
    });

    it("una importación a la vez por agencia", async () => {
      const agency = await newAgency();
      const first = summaryOf(await upload(agency, csv(row("uno"))).expect(201));
      const second = await upload(agency, csv(row("dos"))).expect(409);
      expect(second.body.code).toBe("IMPORT_IN_PROGRESS");
      expect(await prisma.agencyImport.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(1);
      await prisma.agencyImport.delete({ where: { id: first.id } });
      await queue.obliterate({ force: true });
    });
  });

  // ---- idempotencia y cupo ------------------------------------------------------------------------------------------

  describe("idempotencia y cupo", () => {
    it("reimportar el mismo archivo no duplica: todo queda como «ya existía» y no se vuelve a invitar a nadie", async () => {
      const agency = await newAgency();
      const text = csv(row("uno"), row("dos"));
      startWorker();
      try {
        const first = summaryOf(await upload(agency, text).expect(201));
        await waitUntilDone(agency, first.id);
        const mails = emailAdapter.messages.length;
        const orgsBefore = await prisma.organization.count({ where: { slug: { startsWith: "imp-e2e-c" } } });

        const second = summaryOf(await upload(agency, text).expect(201));
        const done = await waitUntilDone(agency, second.id);
        expect(done.import).toMatchObject({ status: "COMPLETED", createdRows: 0, existedRows: 2, errorRows: 0 });
        expect(done.rows.items.map((item) => item.status)).toEqual(["EXISTED", "EXISTED"]);
        expect(emailAdapter.messages.length).toBe(mails);
        expect(await prisma.organization.count({ where: { slug: { startsWith: "imp-e2e-c" } } })).toBe(orgsBefore);
        expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(2);
      } finally {
        await stopWorker();
      }
    });

    it("respeta el cupo de clientes del plan: queda congelado al subir y las filas que no caben salen con su error", async () => {
      const agency = await newAgency(2);
      const summary = summaryOf(await upload(agency, csv(row("a"), row("b"), row("c"), row("d"))).expect(201));
      expect(summary.clientsLimit).toBe(2);
      startWorker();
      try {
        const done = await waitUntilDone(agency, summary.id);
        expect(done.import).toMatchObject({ status: "COMPLETED", createdRows: 2, errorRows: 2, processedRows: 4 });
        expect(done.rows.items.map((item) => item.errorCode)).toEqual([null, null, "NO_QUOTA", "NO_QUOTA"]);
        expect(done.rows.items[2]?.errorMessage).toContain("cupo de clientes");
        expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.agencyId, status: { not: "ENDED" } } })).toBe(2);
        const status = (await agency.agent.get(`/api/v1/organizations/${agency.agencyId}/agency`).expect(200)).body;
        expect(status).toMatchObject({ clientsUsed: 2, clientsLimit: 2 });
      } finally {
        await stopWorker();
      }
    });

    it("un identificador ya usado por otro negocio es un error de esa fila", async () => {
      const agency = await newAgency();
      const taken = unique("imp-e2e-taken");
      await prisma.organization.create({ data: { name: "Ya existe", slug: taken } });
      const summary = summaryOf(await upload(agency, csv(`Choca;${taken};a@b.cl;`, row("sigue"))).expect(201));
      startWorker();
      try {
        const done = await waitUntilDone(agency, summary.id);
        expect(done.rows.items.map((item) => [item.status, item.errorCode])).toEqual([["ERROR", "SLUG_TAKEN"], ["CREATED", null]]);
      } finally {
        await stopWorker();
      }
    });
  });

  // ---- informe de errores -------------------------------------------------------------------------------------------

  describe("informe de errores", () => {
    it("se descarga como CSV seguro: la línea del archivo, el motivo y ninguna fórmula ejecutable", async () => {
      const agency = await newAgency();
      const summary = summaryOf(await upload(agency, csv("=HYPERLINK(\"http://x.test\");NO VALIDO;a@b.cl;", row("bien"), "@SUM(A1);otro-x;mal-correo;")).expect(201));
      startWorker();
      try {
        await waitUntilDone(agency, summary.id);
      } finally {
        await stopWorker();
      }
      const res = await agency.agent.get(`${agency.base}/imports/${summary.id}/errors.csv`).expect(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.text.startsWith("\uFEFF")).toBe(true);
      const parsed = parseCsv(res.text);
      const rows = parsed.ok ? parsed.rows : [];
      expect(rows[0]).toEqual(["fila", "nombre", "identificador", "correo_del_propietario", "problema"]);
      // Las filas de datos 1 y 3 son las líneas 2 y 4 del archivo.
      expect(rows.map((cells) => cells[0])).toEqual(["fila", "2", "4"]);
      // Lo que una hoja de cálculo ejecutaría queda como texto.
      expect(rows[1]?.[1]).toBe("'=HYPERLINK(\"http://x.test\")");
      expect(rows[2]?.[1]).toBe("'@SUM(A1)");
      for (const cells of rows.slice(1)) for (const cell of cells) expect(cell).not.toMatch(/^[=+\-@]/);
    });

    it("el detalle se pagina", async () => {
      const agency = await newAgency();
      const bad = Array.from({ length: 30 }, (_, index) => `n${index};NO VALIDO;a@b.cl;`);
      const summary = summaryOf(await upload(agency, csv(...bad)).expect(201));
      const first = await detail(agency, summary.id, "?pageSize=10&page=1");
      const last = await detail(agency, summary.id, "?pageSize=10&page=3");
      expect(first.rows).toMatchObject({ total: 30, page: 1, pageSize: 10 });
      expect(first.rows.items.map((item) => item.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(last.rows.items.map((item) => item.rowNumber)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
      for (const bad of ["page=0", "pageSize=0", "pageSize=101", "onlyErrors=quizas"]) await agency.agent.get(`${agency.base}/imports/${summary.id}?${bad}`).expect(400);
    });
  });

  // ---- permisos y aislamiento ---------------------------------------------------------------------------------------

  describe("permisos y aislamiento (ADR-002)", () => {
    it("una agencia no ve ni descarga las importaciones de otra", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const summary = summaryOf(await upload(agencyA, csv("x;a;mal;")).expect(201));

      await agencyB.agent.get(`${agencyB.base}/imports/${summary.id}`).expect(404);
      await agencyB.agent.get(`${agencyB.base}/imports/${summary.id}/errors.csv`).expect(404);
      expect(agencyImportListResponse.parse((await agencyB.agent.get(`${agencyB.base}/imports`).expect(200)).body).items).toEqual([]);
      // Con la sesión de B no se puede hablar en nombre de A.
      await agencyB.agent.get(`${agencyA.base}/imports`).expect(403);
      await agencyB.agent.post(`${agencyA.base}/import`).set(CSRF).send({ csv: csv(row("intruso")) }).expect(403);
      await agencyB.agent.get(`${agencyA.base}/import/template`).expect(403);
      expect(await prisma.agencyImport.count({ where: { agencyOrganizationId: agencyA.agencyId } })).toBe(1);
    });

    it("solo con sesión, con el encabezado anti-CSRF y siendo una agencia con el permiso", async () => {
      const agency = await newAgency();
      await request(httpServer).get(`${agency.base}/import/template`).expect(401);
      await request(httpServer).post(`${agency.base}/import`).set(CSRF).send({ csv: csv(row("x")) }).expect(401);
      await agency.agent.post(`${agency.base}/import`).send({ csv: csv(row("x")) }).expect(403);

      const plain = await newUser("plain");
      const created = await plain.agent.post("/api/v1/organizations").set(CSRF).send({ name: "No agencia", slug: unique("imp-e2e") }).expect(201);
      const base = `/api/v1/organizations/${created.body.id as string}/agency/clients`;
      for (const [method, path] of [["get", "import/template"], ["get", "imports"]] as const) {
        const res = await plain.agent[method](`${base}/${path}`).expect(403);
        expect(res.body.code).toBe("NOT_AN_AGENCY");
      }
      expect((await plain.agent.post(`${base}/import`).set(CSRF).send({ csv: csv(row("x")) }).expect(403)).body.code).toBe("NOT_AN_AGENCY");

      // Un miembro de la agencia sin el permiso de administrar clientes tampoco.
      const editor = await newUser("editor");
      const invited = await agency.agent.post(`/api/v1/organizations/${agency.agencyId}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(201);
      await editor.agent.post(`/api/v1/memberships/${invited.body.membershipId}/accept`).set(CSRF).expect(204);
      await editor.agent.get(`${agency.base}/imports`).expect(403);
      await editor.agent.get(`${agency.base}/import/template`).expect(403);
      await editor.agent.post(`${agency.base}/import`).set(CSRF).send({ csv: csv(row("x")) }).expect(403);
    });

    it("un identificador de importación que no es un UUID es 400", async () => {
      const agency = await newAgency();
      await agency.agent.get(`${agency.base}/imports/no-es-uuid`).expect(400);
      await agency.agent.get(`${agency.base}/imports/00000000-0000-4000-8000-000000000000`).expect(404);
    });

    it("limita cuántos archivos se pueden subir por minuto", async () => {
      const agency = await newAgency();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await upload(agency, "")).status);
      expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
      expect(statuses[5]).toBe(429);
    });
  });
});
