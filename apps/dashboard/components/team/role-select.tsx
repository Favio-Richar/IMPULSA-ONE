"use client";

import { Select } from "@impulza/ui";
import type { RolesResponse } from "@impulza/contracts";
import { encodeChoice, roleLabel } from "./team-text";

/**
 * Elegir un rol del sistema o uno personalizado. Solo ofrece lo que el servidor deja asignar y lo que quien consulta puede dar
 * (nadie entrega permisos que no tiene); el servidor lo vuelve a comprobar en cada cambio.
 */
export function RoleSelect({
  roles,
  value,
  onChange,
  label,
  disabled,
  id,
}: {
  roles: RolesResponse;
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}): React.JSX.Element {
  const held = new Set(roles.actorPermissions);
  const canGive = (permissions: string[]) => permissions.every((permission) => held.has(permission));
  const options = [
    ...roles.system.filter((role) => role.assignable && canGive(role.permissions)).map((role) => ({ value: encodeChoice({ role: role.name }), label: roleLabel(role.name) })),
    ...roles.custom.filter((role) => canGive(role.permissions)).map((role) => ({ value: encodeChoice({ customRoleId: role.id }), label: `${role.name} (personalizado)` })),
  ];
  // Si el rol actual no es uno que quien consulta pueda dar, se muestra igual para que el menú no mienta.
  const shown = options.some((option) => option.value === value) ? options : [{ value, label: value.startsWith("custom:") ? "Rol personalizado" : roleLabel(value.slice("role:".length)) }, ...options];
  return <Select id={id} label={label} value={value} onChange={(event) => onChange(event.target.value)} options={shown} disabled={disabled} />;
}
