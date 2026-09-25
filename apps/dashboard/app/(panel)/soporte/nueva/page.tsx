"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, EmptyState, Input, Textarea } from "@impulza/ui";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../../../lib/api-client";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { useOpenSupportTicket } from "../../../../lib/hooks/use-support";

// Mismas reglas que el servidor (`apps/api/src/modules/support/dto/support.dto.ts`): se avisan
// antes de enviar, y el servidor las vuelve a aplicar igual.
const newTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(5, "El asunto necesita al menos 5 caracteres.")
    .max(120, "El asunto admite hasta 120 caracteres."),
  body: z.string().trim().min(10, "Cuéntanos un poco más (al menos 10 caracteres).").max(5000, "El mensaje admite hasta 5.000 caracteres."),
});
type NewTicketValues = z.infer<typeof newTicketSchema>;

export default function NuevaSolicitudPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para escribir al equipo." />;
  }
  return <NewTicketForm organizationId={activeOrganizationId} />;
}

function NewTicketForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const router = useRouter();
  const openMutation = useOpenSupportTicket(organizationId);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewTicketValues>({ resolver: zodResolver(newTicketSchema) });
  const bodyLength = watch("body")?.length ?? 0;

  async function onSubmit(values: NewTicketValues): Promise<void> {
    const ticket = await openMutation.mutateAsync(values).catch(() => null);
    if (ticket) {
      router.push(`/soporte/${ticket.id}`);
    }
  }

  const serverError =
    openMutation.error instanceof ApiError && openMutation.error.status === 429
      ? "Enviaste varias solicitudes seguidas. Espera un momento antes de abrir otra."
      : openMutation.isError
        ? "No pudimos enviar tu solicitud. Intenta de nuevo."
        : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link href="/soporte" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Soporte
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Nueva solicitud</h1>
        <p className="text-sm text-muted-foreground">Mientras más detalle nos des, más rápido podemos ayudarte.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5 rounded-lg border border-border bg-background p-4 sm:p-6">
        <Input
          label="Asunto"
          required
          maxLength={120}
          placeholder="Por ejemplo: no puedo publicar mi página"
          error={errors.subject?.message}
          {...register("subject")}
        />
        <Textarea
          label="Detalle"
          required
          rows={7}
          maxLength={5000}
          placeholder="Qué intentabas hacer, qué pasó y en qué pantalla."
          error={errors.body?.message}
          helperText={`${bodyLength.toLocaleString("es-CL")} / 5.000`}
          {...register("body")}
        />
        <p className="flex gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Nunca escribas contraseñas ni datos de tarjetas. El equipo de Impulza One no te los va a pedir.
        </p>
        {serverError ? (
          <p role="alert" className="text-sm text-danger">
            {serverError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="secondary">
            <Link href="/soporte">Cancelar</Link>
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Enviar solicitud
          </Button>
        </div>
      </form>
    </div>
  );
}
