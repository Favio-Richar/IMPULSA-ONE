"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@impulza/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PlanLimitNotice } from "../plan-limit-notice";
import { ApiError } from "../../lib/api-client";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { useInviteWithRole, useRoles } from "../../lib/hooks/use-team";
import { RoleSelect } from "./role-select";
import { decodeChoice, encodeChoice, serverMessage } from "./team-text";

const inviteSchema = z.object({ email: z.email("Ingresa un correo válido.") });
type InviteValues = z.infer<typeof inviteSchema>;

/** Invitar con un rol del sistema o uno personalizado. Solo se ofrecen los roles que quien invita puede dar. */
export function InviteCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const roles = useRoles(organizationId);
  const invite = useInviteWithRole(organizationId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema) });
  const [choice, setChoice] = useState<string>(encodeChoice({ role: "EDITOR" }));

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Invitar miembro</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit((values) =>
            invite.mutate({ email: values.email, choice: decodeChoice(choice) }, { onSuccess: () => reset() }),
          )}
        >
          <Input label="Correo" type="email" error={errors.email?.message} {...register("email")} />
          {roles.data ? <RoleSelect roles={roles.data} label="Rol" value={choice} onChange={setChoice} /> : null}

          {invite.isError && getPlanLimitInfo(invite.error) ? (
            <PlanLimitNotice error={invite.error} />
          ) : invite.isError ? (
            <p role="alert" className="text-sm text-danger" data-testid="invite-error">
              {invite.error instanceof ApiError && invite.error.status === 404 && !(invite.error.body as { code?: unknown } | undefined)?.code
                ? serverMessage(invite.error, "No existe una cuenta registrada con ese correo todavía.")
                : serverMessage(invite.error, "No pudimos enviar la invitación.")}
            </p>
          ) : null}
          {invite.isSuccess ? <p className="text-sm text-success">Invitación enviada.</p> : null}

          <Button type="submit" loading={invite.isPending} disabled={!roles.data}>
            Invitar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
