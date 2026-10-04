"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import type { CustomRoleResponse } from "@impulza/contracts";
import { PERMISSION_MODULES } from "@impulza/validation";
import { useState } from "react";
import { ConfirmButton } from "../confirm-button";
import { useDeleteCustomRole, useRoles } from "../../lib/hooks/use-team";
import { RoleEditor } from "./role-editor";
import { roleLabel, serverMessage } from "./team-text";

const ACTION_LABEL = new Map<string, string>(
  PERMISSION_MODULES.flatMap((entry) => entry.actions.map((action) => [action.permission, `${entry.label}: ${action.label}`] as const)),
);

// En el orden del catálogo (por módulo), no alfabético: así se lee agrupado.
const ORDER = [...ACTION_LABEL.keys()];
const permissionText = (permissions: string[]): string =>
  permissions.length === 0
    ? "Solo ver"
    : [...permissions]
        .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
        .map((permission) => ACTION_LABEL.get(permission) ?? permission)
        .join(" · ");

/** Roles de la organización: los del sistema como referencia y los personalizados, con su editor. */
export function RolesPanel({ organizationId }: { organizationId: string }): React.JSX.Element {
  const roles = useRoles(organizationId);
  const remove = useDeleteCustomRole(organizationId);
  // `undefined` = ningún editor abierto; `null` = rol nuevo; un rol = editándolo.
  const [editing, setEditing] = useState<CustomRoleResponse | null | undefined>(undefined);

  if (roles.isPending) return <LoadingState label="Cargando los roles…" />;
  if (roles.isError) return <ErrorState onRetry={() => void roles.refetch()} />;

  const { custom, system, maxCustomRoles } = roles.data;
  const full = custom.length >= maxCustomRoles;

  return (
    <div className="flex flex-col gap-6">
      {editing !== undefined ? (
        <RoleEditor key={editing?.id ?? "nuevo"} organizationId={organizationId} roles={roles.data} role={editing} onDone={() => setEditing(undefined)} />
      ) : null}

      <Card data-testid="custom-roles-card">
        <CardHeader>
          <CardTitle>Roles personalizados</CardTitle>
          <CardDescription>
            Arma un rol con los permisos justos para una tarea. Nadie puede dar permisos que no tiene, ni editar su propio rol.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {custom.length === 0 ? (
            <EmptyState title="Aún no hay roles personalizados" description="Los roles del sistema cubren lo habitual; crea uno propio si necesitas algo más fino." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {custom.map((role) => (
                <li key={role.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="custom-role" data-role-name={role.name}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">{role.name}</span>
                    {role.description ? <span className="text-sm text-muted-foreground">{role.description}</span> : null}
                    <span className="text-xs text-muted-foreground">{permissionText(role.permissions)}</span>
                    <span className="text-xs text-muted-foreground">{role.memberCount === 1 ? "1 persona" : `${role.memberCount} personas`}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(role)}>
                      Editar
                    </Button>
                    <ConfirmButton size="sm" variant="ghost" confirmLabel={`¿Borrar «${role.name}»?`} loading={remove.isPending} onConfirm={() => remove.mutate(role.id)}>
                      Borrar
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {remove.isError ? (
            <p role="alert" className="text-sm text-danger" data-testid="role-delete-error">
              {serverMessage(remove.error, "No pudimos borrar el rol.")}
            </p>
          ) : null}
          <div>
            <Button onClick={() => setEditing(null)} disabled={full || editing !== undefined}>
              Nuevo rol
            </Button>
            {full ? <p className="mt-2 text-sm text-muted-foreground">Llegaste al tope de {maxCustomRoles} roles personalizados.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles del sistema</CardTitle>
          <CardDescription>Vienen con la plataforma y no se editan.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {system
              .filter((role) => role.name !== "SUPER_ADMIN")
              .map((role) => (
                <li key={role.name} className="flex flex-col gap-1 py-3">
                  <span className="text-sm font-semibold text-foreground">{roleLabel(role.name)}</span>
                  <span className="text-xs text-muted-foreground">{permissionText(role.permissions)}</span>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
