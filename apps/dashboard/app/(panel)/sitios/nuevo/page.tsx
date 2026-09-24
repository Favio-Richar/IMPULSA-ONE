"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { publicSlugSchema } from "@impulza/validation";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input } from "@impulza/ui";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import { useCreateSite } from "../../../../lib/hooks/use-sites";
import { PlanLimitNotice } from "../../../../components/plan-limit-notice";
import { getPlanLimitInfo } from "../../../../lib/plan-limit";

const createSiteFormSchema = z.object({
  name: z.string().min(2, "Mínimo 2 caracteres.").max(120),
  slug: publicSlugSchema,
});
type CreateSiteFormValues = z.infer<typeof createSiteFormSchema>;

export default function NuevoSitioPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para crear un sitio."
      />
    );
  }

  return <CreateSiteForm organizationId={activeOrganizationId} />;
}

function CreateSiteForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const router = useRouter();
  const createMutation = useCreateSite(organizationId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateSiteFormValues>({ resolver: zodResolver(createSiteFormSchema) });

  async function onSubmit(values: CreateSiteFormValues): Promise<void> {
    try {
      const site = await createMutation.mutateAsync(values);
      router.push(`/sitios/${site.id}`);
    } catch (error) {
      // Límite de plan (F4.3): lo muestra <PlanLimitNotice>, no el error genérico.
      if (getPlanLimitInfo(error)) {
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setError("slug", { message: "Ese slug ya está tomado. Elige otro." });
        return;
      }
      setError("root", { message: "Ocurrió un error inesperado. Intenta de nuevo." });
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Crear sitio</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input label="Nombre" error={errors.name?.message} {...register("name")} />
          <Input
            label="Slug"
            helperText={errors.slug ? undefined : "Tu URL pública: impulza.one/tu-slug."}
            error={errors.slug?.message}
            {...register("slug")}
          />
          {errors.root ? (
            <p role="alert" className="text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          <PlanLimitNotice error={createMutation.error} />
          <Button type="submit" loading={createMutation.isPending} className="mt-2">
            Crear sitio
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
