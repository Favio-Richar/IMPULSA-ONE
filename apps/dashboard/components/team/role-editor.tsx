"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Textarea } from "@impulza/ui";
import type { CustomRoleResponse, RolesResponse } from "@impulza/contracts";
import { PERMISSION_MODULES, customRoleSchema, type CustomRoleDto } from "@impulza/validation";
import { useState } from "react";
import { useSaveCustomRole } from "../../lib/hooks/use-team";
import { serverMessage } from "./team-text";

/**
 * Editor de un rol personalizado: nombre, descripción y una matriz módulo × acción con el catálogo cerrado de permisos.
 * Lo que quien edita no tiene aparece desactivado y explicado (nadie entrega lo que no tiene); el servidor lo vuelve a comprobar.
 */
export function RoleEditor({
  organizationId,
  roles,
  role,
  onDone,
}: {
  organizationId: string;
  roles: RolesResponse;
  /** `null` = rol nuevo. */
  role: CustomRoleResponse | null;
  onDone: () => void;
}): React.JSX.Element {
  const save = useSaveCustomRole(organizationId);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; permissions?: string }>({});
  const held = new Set(roles.actorPermissions);
  // Editar un rol exige tener todos sus permisos actuales: si no, se le quitarían a alguien permisos que quien edita no maneja.
  const lacksCurrent = (role?.permissions ?? []).some((permission) => !held.has(permission));

  function toggle(permission: string, on: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const parsed = customRoleSchema.safeParse({ name, description, permissions: [...selected] });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      setFieldErrors({
        name: issues.find((issue) => issue.path[0] === "name")?.message,
        permissions: issues.find((issue) => issue.path[0] === "permissions")?.message,
      });
      return;
    }
    setFieldErrors({});
    const body: CustomRoleDto = parsed.data;
    save.mutate({ roleId: role?.id ?? null, body }, { onSuccess: onDone });
  }

  return (
    <Card data-testid="role-editor">
      <CardHeader>
        <CardTitle>{role ? `Editar «${role.name}»` : "Nuevo rol"}</CardTitle>
        <CardDescription>Elige qué puede hacer quien tenga este rol. Ver información de la organización no necesita permiso: lo tiene todo el equipo.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <Input label="Nombre del rol" value={name} onChange={(event) => setName(event.target.value)} error={fieldErrors.name} maxLength={40} />
          <Textarea label="Descripción (opcional)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} rows={2} />

          {lacksCurrent ? (
            <p role="alert" className="text-sm text-danger" data-testid="role-locked">
              Este rol tiene permisos que tú no tienes, así que no puedes editarlo.
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2" disabled={lacksCurrent}>
            <legend className="text-sm font-medium text-foreground">Permisos</legend>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="permission-matrix">
              {PERMISSION_MODULES.map((entry) => (
                <div key={entry.module} className="flex flex-col gap-2 rounded-md border border-border p-3" data-module={entry.module}>
                  <span className="text-sm font-semibold text-foreground">{entry.label}</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {entry.actions.map((action) => {
                      const allowed = held.has(action.permission);
                      const id = `perm-${action.permission}`;
                      return (
                        <label key={action.permission} htmlFor={id} className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            id={id}
                            type="checkbox"
                            className="size-4 accent-[var(--color-primary)]"
                            checked={selected.has(action.permission)}
                            disabled={!allowed && !selected.has(action.permission)}
                            onChange={(event) => toggle(action.permission, event.target.checked)}
                            aria-describedby={allowed ? undefined : `${id}-why`}
                          />
                          <span>{action.label}</span>
                          {allowed ? null : (
                            <span id={`${id}-why`} className="text-xs text-muted-foreground">
                              (tú no lo tienes)
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {fieldErrors.permissions ? (
              <p role="alert" className="text-sm text-danger">
                {fieldErrors.permissions}
              </p>
            ) : null}
          </fieldset>

          {save.isError ? (
            <p role="alert" className="text-sm text-danger" data-testid="role-error">
              {serverMessage(save.error, "No pudimos guardar el rol.")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending} disabled={lacksCurrent}>
              {role ? "Guardar cambios" : "Crear rol"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
