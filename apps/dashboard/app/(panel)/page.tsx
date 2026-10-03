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
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { ApiError } from "../../lib/api-client";
import { createOrganization, listMembers, listMyOrganizations, type Organization } from "../../lib/api/organizations";

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
        {/* PL4: el camino recomendado es el asistente (PM §8.2), que crea la organización, el sitio
            y la página desde una plantilla. La creación manual de abajo sigue disponible. */}
        <Card className="mt-4 border-primary">
          <CardHeader>
            <CardTitle>Crea tu página en pocos minutos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Te guiamos paso a paso: eliges una plantilla para tu rubro, agregas tus datos y la publicas.
            </p>
            <Button asChild>
              <Link href="/bienvenida">Empezar con el asistente</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>O crea solo la organización</CardTitle>
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

  // El equipo de un cliente lo decide su propietario: el servidor se lo niega a la agencia (AGENCY_LIMIT), así que ni se pide.
  const active = orgsQuery.data.find((org) => org.id === activeOrganizationId);
  if (active?.access?.delegated) {
    return <DelegatedHome organization={active} />;
  }

  return <OrganizationMembers organizationId={activeOrganizationId} />;
}

const DELEGATED_SHORTCUTS = [
  { href: "/sitios", label: "Sitios", description: "Páginas, bloques y publicación." },
  { href: "/contactos", label: "Contactos", description: "Personas que llegaron por formularios y pedidos." },
  { href: "/analitica", label: "Analítica", description: "Visitas, clics y conversiones." },
  { href: "/campanas", label: "Campañas", description: "Correos a sus contactos." },
  { href: "/reservas", label: "Reservas", description: "Agenda y servicios." },
  { href: "/catalogo", label: "Catálogo", description: "Productos y precios." },
  { href: "/medios", label: "Medios", description: "Imágenes y archivos." },
  { href: "/configuracion/marca", label: "Marca", description: "Colores y logo del negocio." },
] as const;

/** Inicio de quien entra a un cliente desde una agencia: sin tabla de equipo, con lo que sí puede trabajar. */
function DelegatedHome({ organization }: { organization: Organization }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6" data-testid="delegated-home">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">
          Trabajas en este negocio a través de {organization.access?.agencyName ?? "tu agencia"}. El equipo, los cobros y la suscripción los decide su propietario.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DELEGATED_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.href}>
            <Link
              href={shortcut.href}
              className="flex h-full flex-col gap-1 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="text-sm font-semibold text-foreground">{shortcut.label}</span>
              <span className="text-xs text-muted-foreground">{shortcut.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
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
