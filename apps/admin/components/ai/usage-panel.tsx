"use client";

import type { AdminAiUsageResponse } from "@impulza/contracts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@impulza/ui";
import { AI_TASK_LABELS, formatMicroUsd, type AiTaskCode } from "@impulza/validation";
import Link from "next/link";
import { formatInteger } from "../../lib/format";

function taskLabel(task: string): string {
  if (task === "connection_test") {
    return "Pruebas de conexión";
  }
  return AI_TASK_LABELS[task as AiTaskCode]?.label ?? task;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Consumo de IA del mes (F6.2b): lo que se pidió, lo que falló y cuánto costó. */
export function UsagePanel({ usage }: { usage: AdminAiUsageResponse }): React.JSX.Element {
  const { totals } = usage;
  if (totals.attempts === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay uso de IA este mes ({usage.period}).</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solicitudes con resultado" value={formatInteger(totals.requests)} />
        <Stat label="Intentos fallidos" value={formatInteger(totals.failures)} />
        <Stat label="Tokens" value={formatInteger(totals.inputTokens + totals.outputTokens)} />
        <Stat label="Costo estimado" value={formatMicroUsd(totals.costMicroUsd)} />
      </div>

      <UsageTable
        caption="Por conexión"
        firstColumn="Conexión"
        rows={usage.byConnection.map((row) => ({ key: row.connectionId ?? row.name, label: row.name, ...row }))}
      />
      <UsageTable caption="Por tarea" firstColumn="Tarea" rows={usage.byTask.map((row) => ({ key: row.task, label: taskLabel(row.task), ...row }))} />

      {usage.topOrganizations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Organizaciones con más uso</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organización</TableHead>
                  <TableHead className="text-right">Solicitudes</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.topOrganizations.map((org) => (
                  <TableRow key={org.organizationId}>
                    <TableCell>
                      <Link href={`/organizaciones/${org.organizationId}`} className="text-primary hover:underline">
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(org.requests)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMicroUsd(org.costMicroUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string;
  firstColumn: string;
  rows: Array<{ key: string; label: string; requests: number; attempts: number; failures: number; inputTokens: number; outputTokens: number; costMicroUsd: number }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{caption}</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{firstColumn}</TableHead>
              <TableHead className="text-right">Solicitudes</TableHead>
              <TableHead className="text-right">Fallas</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Costo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-[16rem] truncate">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInteger(row.failures)} de {formatInteger(row.attempts)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.inputTokens + row.outputTokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMicroUsd(row.costMicroUsd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
