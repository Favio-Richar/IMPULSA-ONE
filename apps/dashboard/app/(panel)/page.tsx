"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { ApiError } from "../../lib/api-client";
import { createOrganization, listMembers, listMyOrganizations } from "../../lib/api/organizations";

const createOrgSchema = z.object({
  name: z.string().min(2, "Mínimo 2 caracteres."),
  slug: z
    .string()
    .min(3, "Mínimo 3 caracteres.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, dígitos y guiones."),
});
type CreateOrgValues = z.infer<typeof createOrgSchema>;

export default function PanelHomePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  const orgsQuery = useQuery({ queryKey: ["organizations"], queryFn: listMyOrganizations });

  const createOrgMutation = useMutation({
    mutationFn: ({ name, slug }: CreateOrgValues) => createOrganization(name, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CreateOrgValues>({ resolver: zodResolver(createOrgSchema) });

  async function onCreateOrg(values: CreateOrgValues): Promise<void> {
    await createOrgMutation.mutateAsync(values);
    reset();
  }

  if (orgsQuery.isPending) {
    return <LoadingState label="Cargando tus organizaciones…" />;
  }

  if (orgsQuery.isError) {
    return <ErrorState onRetry={() => orgsQuery.refetch()} />;
  }

  // Estado: vacío — todavía no tiene ninguna organización.
  if (orgsQuery.data.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          title="Todavía no tienes una organización"
          description="Crea la primera para empezar a construir tu sitio."
        />
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Crear organización</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit(onCreateOrg)} noValidate>
              <Input label="Nombre" error={errors.name?.message} {...register("name")} />
              <Input
                label="Slug"
                helperText={errors.slug ? undefined : "Se usa en tu URL pública. Ej: mi-negocio."}
                error={errors.slug?.message}
                {...register("slug")}
              />
              <Button type="submit" loading={createOrgMutation.isPending}>
                Crear
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeOrganizationId) {
    return <LoadingState />;
  }

  return <OrganizationMembers organizationId={activeOrganizationId} />;
}

function OrganizationMembers({ organizationId }: { organizationId: string }): React.JSX.Element {
  const membersQuery = useQuery({
    queryKey: ["members", organizationId],
    queryFn: () => listMembers(organizationId),
  });

  if (membersQuery.isPending) {
    return <LoadingState label="Cargando miembros…" />;
  }

  if (membersQuery.isError) {
    // Estado: sin permisos — la membresía activa pudo haber sido removida mientras navegabas.
    if (membersQuery.error instanceof ApiError && membersQuery.error.status === 403) {
      return (
        <ErrorState
          title="Sin acceso"
          description="Ya no tienes acceso a esta organización."
          onRetry={() => membersQuery.refetch()}
        />
      );
    }
    return <ErrorState onRetry={() => membersQuery.refetch()} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Miembros</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Correo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {membersQuery.data.map((member) => (
              <TableRow key={member.membershipId}>
                <TableCell>{member.email}</TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell>{member.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
