"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import type { RolesResponse } from "@impulza/contracts";
import { ConfirmButton } from "../confirm-button";
import type { Member } from "../../lib/api/organizations";
import { decodeChoice, encodeChoice, roleLabel, serverMessage } from "./team-text";
import { RoleSelect } from "./role-select";
import { useChangeMemberRole, useMembers, useRemoveMember, useRoles } from "../../lib/hooks/use-team";

/** El equipo de la organización: quién es quién, con qué rol, y cambiar o quitar a cada persona. El servidor decide qué se permite. */
export function MembersCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const members = useMembers(organizationId);
  const roles = useRoles(organizationId);

  if (members.isPending || roles.isPending) return <LoadingState label="Cargando el equipo…" />;
  if (members.isError || roles.isError) return <ErrorState onRetry={() => { void members.refetch(); void roles.refetch(); }} />;

  const direct = members.data.filter((member) => member.source === "DIRECT");
  const delegated = members.data.filter((member) => member.source === "AGENCY");

  return (
    <Card data-testid="members-card">
      <CardHeader>
        <CardTitle>Equipo</CardTitle>
        <CardDescription>Las personas que trabajan en esta organización y lo que puede hacer cada una.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {direct.length === 0 ? (
          <EmptyState title="Todavía no hay equipo" description="Invita a alguien para trabajar juntos." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {direct.map((member) => (
              <MemberRow key={member.membershipId} organizationId={organizationId} member={member} roles={roles.data} />
            ))}
          </ul>
        )}
        {delegated.length > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="members-delegated">
            {delegated.length === 1 ? "1 persona de tu agencia tiene" : `${delegated.length} personas de tu agencia tienen`} acceso delegado. Su acceso se gestiona en Configuración › Agencia.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MemberRow({ organizationId, member, roles }: { organizationId: string; member: Member; roles: RolesResponse }): React.JSX.Element {
  const change = useChangeMemberRole(organizationId);
  const remove = useRemoveMember(organizationId);
  const isOwner = member.role === "OWNER";
  const value = encodeChoice(member.customRoleId ? { customRoleId: member.customRoleId } : { role: member.role });
  const error = change.isError ? serverMessage(change.error, "No pudimos cambiar el rol.") : remove.isError ? serverMessage(remove.error, "No pudimos quitar a esta persona.") : null;

  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-end sm:justify-between" data-testid="member-row" data-member-email={member.email}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{member.email}</span>
        <span className="text-xs text-muted-foreground">{member.status === "INVITED" ? "Invitación pendiente" : "Activo"}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {isOwner ? (
          <span className="text-sm text-foreground" data-testid="member-owner">{roleLabel("OWNER")}</span>
        ) : (
          <RoleSelect
            roles={roles}
            label={`Rol de ${member.email}`}
            value={value}
            disabled={change.isPending || remove.isPending}
            onChange={(next) => change.mutate({ membershipId: member.membershipId, choice: decodeChoice(next) })}
          />
        )}
        {isOwner ? null : (
          <ConfirmButton variant="ghost" size="sm" confirmLabel={`¿Quitar a ${member.email}?`} loading={remove.isPending} onConfirm={() => remove.mutate(member.membershipId)}>
            Quitar
          </ConfirmButton>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger sm:basis-full" data-testid="member-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}
