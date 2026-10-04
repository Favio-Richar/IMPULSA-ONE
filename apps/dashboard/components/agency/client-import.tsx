"use client";

import type { AgencyImportRow, AgencyImportSummary } from "@impulza/contracts";
import { AGENCY_IMPORT_MAX_CHARS, AGENCY_IMPORT_MAX_ROWS } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingState } from "@impulza/ui";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Download, FileUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { downloadImportErrors, downloadImportTemplate } from "../../lib/api/agency";
import { useAgencyImport, useAgencyImports, useUploadAgencyImport } from "../../lib/hooks/use-agency";
import { errorText } from "./agency-text";

const PAGE_SIZE = 20;
/** Un archivo de varios megabytes no es una lista de clientes: ni se lee. El servidor igual valida su propio tope. */
const MAX_FILE_BYTES = 500_000;
const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });

/** Guarda un texto como archivo CSV en el equipo (el BOM del texto se conserva para que Excel respete las tildes). */
function saveCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Lee el archivo como UTF-8; si no lo es (el «CSV» de Excel en Windows suele guardarse en Windows-1252), lo lee como tal. Así las tildes y las
 * eñes de los nombres no se rompen.
 */
async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

const STATUS_TEXT = { QUEUED: "En cola: esperando a que el sistema empiece.", RUNNING: "Creando clientes…", COMPLETED: "Terminó." } as const;

function Progress({ summary }: { summary: AgencyImportSummary }): React.JSX.Element {
  const percent = summary.totalRows === 0 ? 100 : Math.round((summary.processedRows / summary.totalRows) * 100);
  // La hora vive en estado (no se lee durante el renderizado) y solo se actualiza mientras la importación sigue en cola.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (summary.status !== "QUEUED") return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [summary.status]);
  const waitingLong = summary.status === "QUEUED" && now - new Date(summary.createdAt).getTime() > 30_000;
  return (
    <div className="flex flex-col gap-2" data-testid="import-progress">
      <div role="progressbar" aria-label="Avance de la importación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2.5 w-full overflow-hidden rounded-full border border-border bg-surface">
        <div className="h-full bg-primary motion-safe:transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm text-foreground" aria-live="polite" data-testid="import-counts">
        {summary.processedRows} de {summary.totalRows} filas · {summary.createdRows} creadas · {summary.existedRows} ya existían · {summary.errorRows} con problema
      </p>
      <p className="text-xs text-muted-foreground" data-testid="import-status">
        {STATUS_TEXT[summary.status]}
        {waitingLong ? " Sigue en cola: el procesamiento puede estar en pausa y se retoma solo en un momento." : ""}
      </p>
    </div>
  );
}

function ProblemRow({ row }: { row: AgencyImportRow }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-3" data-testid="import-problem">
      <p className="text-sm font-medium text-foreground">
        Línea {row.rowNumber + 1} <span className="font-normal text-muted-foreground">· {row.name || "(sin nombre)"}</span>
      </p>
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <span>{row.errorMessage ?? "Sin detalle."}</span>
      </p>
      <p className="break-words text-xs text-muted-foreground">
        Identificador: {row.slug || "(vacío)"} · Correo: {row.ownerEmail || "(vacío)"}
      </p>
    </li>
  );
}

/** El avance y el informe de una importación. */
function ImportReport({ organizationId, importId }: { organizationId: string; importId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const report = useAgencyImport(organizationId, importId, { page, pageSize: PAGE_SIZE, onlyErrors: true });
  const status = report.data?.import.status;

  // Al terminar, los clientes nuevos ya existen: se refresca la lista, el resumen y el cupo.
  useEffect(() => {
    if (status === "COMPLETED") void queryClient.invalidateQueries({ queryKey: ["agency", organizationId] });
  }, [status, organizationId, queryClient]);

  if (report.isPending) return <LoadingState label="Leyendo la importación…" />;
  if (report.isError || !report.data) return <ErrorState onRetry={() => void report.refetch()} />;

  const { import: summary, rows } = report.data;
  const pages = Math.max(1, Math.ceil(rows.total / PAGE_SIZE));
  const done = summary.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3" data-testid="import-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{summary.fileName ?? "Importación"}</p>
        <p className="text-xs text-muted-foreground">{dateFormat.format(new Date(summary.createdAt))}</p>
      </div>
      <Progress summary={summary} />

      {done && summary.errorRows === 0 ? (
        <p role="status" className="flex items-start gap-2 text-sm text-foreground" data-testid="import-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            {summary.createdRows > 0 ? `Se crearon ${summary.createdRows} cliente${summary.createdRows === 1 ? "" : "s"} y cada propietario recibió su invitación por correo (vence en 7 días). Los verás en «Tus clientes».` : "Todos los clientes del archivo ya existían: no se creó ninguno nuevo ni se invitó a nadie otra vez."}
          </span>
        </p>
      ) : null}

      {done && summary.errorRows > 0 ? (
        <div className="flex flex-col gap-3" data-testid="import-problems">
          <p className="text-sm text-foreground">
            {summary.errorRows} fila{summary.errorRows === 1 ? "" : "s"} no se importó{summary.errorRows === 1 ? "" : "ron"}. Las demás sí: corrige estas en el archivo y vuelve a subirlo (las que ya se importaron no se duplican).
          </p>
          <ul className="flex flex-col gap-2">
            {rows.items.map((row) => (
              <ProblemRow key={row.rowNumber} row={row} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Páginas del informe" className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Página {page} de {pages}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Anterior
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>
                  Siguiente
                </Button>
              </div>
            </nav>
          ) : null}
          <div className="flex flex-col gap-1">
            <div>
              <Button
                size="sm"
                variant="secondary"
                loading={downloading}
                onClick={() => {
                  setDownloading(true);
                  setDownloadError(null);
                  downloadImportErrors(organizationId, importId)
                    .then((text) => saveCsv("errores-importacion.csv", text))
                    .catch((error: unknown) => setDownloadError(errorText(error, "No pudimos descargar el informe.")))
                    .finally(() => setDownloading(false));
                }}
              >
                <Download className="mr-2 size-4" aria-hidden="true" /> Descargar el informe de errores (CSV)
              </Button>
            </div>
            {downloadError ? (
              <p role="alert" className="text-sm text-danger">
                {downloadError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Importar clientes desde un archivo CSV (F9.5d, ADR-028 §2). El servidor valida el archivo fila por fila; el sistema crea los clientes en segundo plano
 * (cada propietario recibe su invitación) y el avance se ve aquí. Reimportar el mismo archivo no duplica nada.
 */
export function ClientImport({ organizationId }: { organizationId: string }): React.JSX.Element {
  const inputId = useId();
  const upload = useUploadAgencyImport(organizationId);
  const imports = useAgencyImports(organizationId, true);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  // Cambiar la clave del selector lo vacía: tras importar no debe seguir mostrando el archivo ya subido.
  const [inputKey, setInputKey] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const recent = imports.data?.items ?? [];

  return (
    <Card data-testid="client-import">
      <CardHeader>
        <CardTitle className="text-base">Importar clientes desde un archivo</CardTitle>
        <CardDescription>
          Sube un archivo CSV con tus clientes (hasta {AGENCY_IMPORT_MAX_ROWS} filas por archivo). Les creamos su espacio y cada propietario recibe su invitación por correo. Si repites un archivo, no se duplica nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div>
            <Button
              size="sm"
              variant="secondary"
              loading={downloadingTemplate}
              onClick={() => {
                setDownloadingTemplate(true);
                setTemplateError(null);
                downloadImportTemplate(organizationId)
                  .then((text) => saveCsv("plantilla-clientes.csv", text))
                  .catch((error: unknown) => setTemplateError(errorText(error, "No pudimos descargar la plantilla.")))
                  .finally(() => setDownloadingTemplate(false));
              }}
            >
              <Download className="mr-2 size-4" aria-hidden="true" /> Descargar la plantilla
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Columnas: nombre, identificador, correo del propietario y, si quieres, quién paga («cliente» o «agencia»). Sirve con punto y coma o con coma.</p>
          {templateError ? (
            <p role="alert" className="text-sm text-danger">
              {templateError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            Archivo CSV
          </label>
          <input
            key={inputKey}
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm text-foreground file:mr-3 file:h-10 file:rounded-md file:border file:border-border-strong file:bg-background file:px-3 file:text-sm file:font-medium file:text-foreground"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              setFile(null);
              setFileError(null);
              if (!chosen) return;
              if (chosen.size > MAX_FILE_BYTES) {
                setFileError("El archivo es demasiado grande para ser una lista de clientes. Divídelo en varios.");
                return;
              }
              void readCsvFile(chosen).then((text) => {
                if (text.length > AGENCY_IMPORT_MAX_CHARS) setFileError(`El archivo es demasiado grande (máximo ${AGENCY_IMPORT_MAX_CHARS.toLocaleString("es-CL")} caracteres). Divídelo en varios.`);
                else setFile({ name: chosen.name, text });
              });
            }}
          />
          {fileError ? (
            <p role="alert" className="text-sm text-danger">
              {fileError}
            </p>
          ) : null}
          {upload.isError ? (
            <p role="alert" className="text-sm text-danger" data-testid="import-upload-error">
              {errorText(upload.error, "No pudimos subir el archivo. No se creó nada: puedes intentarlo de nuevo.")}
            </p>
          ) : null}
          <div>
            <Button
              size="sm"
              loading={upload.isPending}
              disabled={!file}
              onClick={() => {
                if (!file) return;
                upload.mutate(
                  { csv: file.text, fileName: file.name },
                  {
                    onSuccess: (summary) => {
                      setSelected(summary.id);
                      setFile(null);
                      setInputKey((current) => current + 1);
                    },
                  },
                );
              }}
            >
              <FileUp className="mr-2 size-4" aria-hidden="true" /> Importar clientes
            </Button>
          </div>
        </div>

        {selected ? <ImportReport organizationId={organizationId} importId={selected} /> : null}

        {recent.length > 0 ? (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Importaciones anteriores</summary>
            <ul className="flex flex-col gap-2 p-3 pt-1" data-testid="import-history">
              {recent.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">
                    {item.fileName ?? "Importación"} <span className="text-xs text-muted-foreground">· {dateFormat.format(new Date(item.createdAt))} · {item.createdRows} creadas, {item.errorRows} con problema</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(item.id)}>
                    Ver informe
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
