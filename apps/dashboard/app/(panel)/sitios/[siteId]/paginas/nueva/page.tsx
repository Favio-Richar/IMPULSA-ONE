"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { pageSlugSchema } from "@impulza/validation";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input } from "@impulza/ui";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../../../../../lib/active-org-store";
import { ApiError } from "../../../../../../lib/api-client";
import { useCreatePage } from "../../../../../../lib/hooks/use-pages";

const createPageFormSchema = z.object({
  slug: pageSlugSchema,
  visibility: z.enum(["PUBLIC", "HIDDEN"]),
});
type CreatePageFormValues = z.infer<typeof createPageFormSchema>;

export default function NuevaPaginaPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para crear una página."
      />
    );
  }

  return <CreatePageForm organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function CreatePageForm({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const router = useRouter();
  const createMutation = useCreatePage(organizationId, siteId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreatePageFormValues>({
    resolver: zodResolver(createPageFormSchema),
    defaultValues: { visibility: "PUBLIC" },
  });

  async function onSubmit(values: CreatePageFormValues): Promise<void> {
    try {
      const page = await createMutation.mutateAsync(values);
      router.push(`/sitios/${siteId}/paginas/${page.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError("slug", { message: "Ya existe una página con ese slug en este sitio." });
        return;
      }
      setError("root", { message: "Ocurrió un error inesperado. Intenta de nuevo." });
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Crear página</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input
            label="Slug"
            helperText={errors.slug ? undefined : "La URL de la página dentro del sitio, ej: servicios."}
            error={errors.slug?.message}
            {...register("slug")}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Visibilidad</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              {...register("visibility")}
            >
              <option value="PUBLIC">Pública (aparece en el menú)</option>
              <option value="HIDDEN">Oculta (alcanzable solo por enlace directo)</option>
            </select>
          </label>

          {errors.root ? (
            <p role="alert" className="text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}

          <Button type="submit" loading={createMutation.isPending} className="mt-2">
            Crear página
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
