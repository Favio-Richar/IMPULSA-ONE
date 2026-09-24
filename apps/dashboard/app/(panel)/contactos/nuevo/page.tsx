"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input } from "@impulza/ui";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { useCreateContact } from "../../../../lib/hooks/use-contacts";
import { PlanLimitNotice } from "../../../../components/plan-limit-notice";
import { getPlanLimitInfo } from "../../../../lib/plan-limit";

const createContactFormSchema = z.object({
  name: z.string().max(160).optional().or(z.literal("")),
  email: z.email("Ingresa un correo válido.").optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Usa formato internacional, por ejemplo +56912345678.")
    .optional()
    .or(z.literal("")),
  tags: z.string().max(200).optional(),
});
type CreateContactFormValues = z.infer<typeof createContactFormSchema>;

export default function NuevoContactoPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para agregar un contacto."
      />
    );
  }

  return <CreateContactForm organizationId={activeOrganizationId} />;
}

function CreateContactForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const router = useRouter();
  const createMutation = useCreateContact(organizationId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateContactFormValues>({ resolver: zodResolver(createContactFormSchema) });

  async function onSubmit(values: CreateContactFormValues): Promise<void> {
    try {
      const contact = await createMutation.mutateAsync({
        name: values.name || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        tags: values.tags
          ? values.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
          : undefined,
      });
      router.push(`/contactos/${contact.id}`);
    } catch (error) {
      // Límite de plan (F4.3): lo muestra <PlanLimitNotice>, no el error genérico.
      if (getPlanLimitInfo(error)) {
        return;
      }
      setError("root", { message: "Ocurrió un error inesperado. Intenta de nuevo." });
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Agregar contacto</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input label="Nombre" error={errors.name?.message} {...register("name")} />
          <Input label="Correo" type="email" error={errors.email?.message} {...register("email")} />
          <Input
            label="Teléfono"
            placeholder="+56912345678"
            helperText={errors.phone ? undefined : "Formato internacional."}
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Input
            label="Etiquetas"
            placeholder="vip, prioritario"
            helperText="Separadas por coma."
            error={errors.tags?.message}
            {...register("tags")}
          />
          <p className="text-sm text-muted-foreground">
            Como es un alta manual (sin paso por un formulario público), el consentimiento queda
            «sin declarar» hasta que el contacto lo otorgue explícitamente.
          </p>
          {errors.root ? (
            <p role="alert" className="text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          <PlanLimitNotice error={createMutation.error} />
          <Button type="submit" loading={createMutation.isPending} className="mt-2">
            Agregar contacto
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
