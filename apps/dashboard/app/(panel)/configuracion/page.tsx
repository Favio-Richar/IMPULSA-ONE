"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input } from "@impulza/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { ApiError } from "../../../lib/api-client";
import { inviteMember } from "../../../lib/api/organizations";

const ASSIGNABLE_ROLES = ["ADMIN", "EDITOR", "ANALYST", "SUPPORT", "AGENCY_MANAGER"] as const;

const inviteSchema = z.object({
  email: z.email("Ingresa un correo válido."),
  role: z.enum(ASSIGNABLE_ROLES),
});
type InviteValues = z.infer<typeof inviteSchema>;

export default function ConfiguracionPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para administrar sus miembros."
      />
    );
  }

  return <InviteMemberForm organizationId={activeOrganizationId} queryClient={queryClient} />;
}

function InviteMemberForm({
  organizationId,
  queryClient,
}: {
  organizationId: string;
  queryClient: ReturnType<typeof import("@tanstack/react-query").useQueryClient>;
}): React.JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { role: "EDITOR" } });

  const mutation = useMutation({
    mutationFn: (values: InviteValues) => inviteMember(organizationId, values.email, values.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["members", organizationId] });
      reset();
    },
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Invitar miembro</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <Input label="Correo" type="email" error={errors.email?.message} {...register("email")} />

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Rol</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              {...register("role")}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          {mutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              {mutation.error instanceof ApiError && mutation.error.status === 404
                ? "No existe una cuenta registrada con ese correo todavía."
                : "No pudimos enviar la invitación."}
            </p>
          ) : null}
          {mutation.isSuccess ? (
            <p className="text-sm text-success">Invitación enviada.</p>
          ) : null}

          <Button type="submit" loading={mutation.isPending}>
            Invitar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
