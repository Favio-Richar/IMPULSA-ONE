"use client";

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
  Select,
} from "@impulza/ui";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmButton } from "../../../../components/confirm-button";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import {
  useAddContactNote,
  useContact,
  useDeleteContact,
  useExportContact,
  useUpdateContact,
} from "../../../../lib/hooks/use-contacts";

const COMMERCIAL_STATUS_OPTIONS = [
  { value: "NEW", label: "Nuevo" },
  { value: "CONTACTED", label: "Contactado" },
  { value: "QUALIFIED", label: "Calificado" },
  { value: "WON", label: "Ganado" },
  { value: "LOST", label: "Perdido" },
];

const CONSENT_STATUS_LABEL: Record<string, string> = {
  GRANTED: "Otorgado",
  WITHDRAWN: "Retirado",
  UNKNOWN: "Sin declarar",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  FORM_SUBMISSION: "Envío de formulario",
  BOOKING: "Reserva",
  PURCHASE: "Compra",
  NOTE: "Nota",
};

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ContactoDetallePage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const params = useParams<{ contactId: string }>();

  if (!activeOrganizationId) {
    return (
      <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver este contacto." />
    );
  }

  return <ContactDetail organizationId={activeOrganizationId} contactId={params.contactId} />;
}

function ContactDetail({ organizationId, contactId }: { organizationId: string; contactId: string }): React.JSX.Element {
  const router = useRouter();
  const contactQuery = useContact(organizationId, contactId);
  const updateMutation = useUpdateContact(organizationId, contactId);
  const noteMutation = useAddContactNote(organizationId, contactId);
  const deleteMutation = useDeleteContact(organizationId);
  const exportMutation = useExportContact(organizationId);
  const [tagsInput, setTagsInput] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  if (contactQuery.isPending) {
    return <LoadingState label="Cargando contacto…" />;
  }
  if (contactQuery.isError) {
    return <ErrorState onRetry={() => contactQuery.refetch()} />;
  }

  const contact = contactQuery.data;
  const tagsValue = tagsInput ?? contact.tags.join(", ");

  async function handleSaveTags(): Promise<void> {
    await updateMutation.mutateAsync({
      tags: tagsValue
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    });
    setTagsInput(null);
  }

  async function handleAddNote(): Promise<void> {
    if (noteText.trim().length === 0) return;
    await noteMutation.mutateAsync(noteText.trim());
    setNoteText("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{contact.name ?? "(sin nombre)"}</h1>
          <p className="text-sm text-muted-foreground">{contact.email ?? contact.phone ?? "Sin dato de contacto"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending}
            onClick={async () => {
              const data = await exportMutation.mutateAsync(contactId);
              downloadJson(`contacto-${contactId}.json`, data);
            }}
          >
            Exportar datos
          </Button>
          <ConfirmButton
            variant="destructive"
            size="sm"
            confirmLabel="¿Eliminar este contacto? Se borra también su historial."
            loading={deleteMutation.isPending}
            onConfirm={async () => {
              await deleteMutation.mutateAsync(contactId);
              router.push("/contactos");
            }}
          >
            Eliminar
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Select
              label="Estado comercial"
              options={COMMERCIAL_STATUS_OPTIONS}
              value={contact.commercialStatus}
              onChange={(event) => void updateMutation.mutateAsync({ commercialStatus: event.target.value })}
            />

            <div className="flex flex-col gap-1.5">
              <Input
                label="Etiquetas"
                helperText="Separadas por coma."
                value={tagsValue}
                onChange={(event) => setTagsInput(event.target.value)}
                onBlur={() => void handleSaveTags()}
              />
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm">
              <span className="font-medium text-foreground">Consentimiento</span>
              <span className="text-muted-foreground">
                {CONSENT_STATUS_LABEL[contact.consentStatus] ?? contact.consentStatus}
                {contact.consentSource ? ` — origen: ${contact.consentSource}` : ""}
              </span>
            </div>

            {updateMutation.isError ? (
              <p role="alert" className="text-sm text-danger">
                No se pudo guardar el cambio. Intenta de nuevo.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Línea de tiempo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Input
                label="Agregar nota"
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleAddNote();
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                loading={noteMutation.isPending}
                onClick={() => void handleAddNote()}
              >
                Agregar nota
              </Button>
            </div>

            {contact.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay actividad registrada.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {contact.events.map((event) => (
                  <li key={event.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{EVENT_TYPE_LABEL[event.type] ?? event.type}</span>
                      <time className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString("es-CL")}
                      </time>
                    </div>
                    {event.type === "NOTE" && event.payload && typeof event.payload === "object" ? (
                      <p className="mt-1 text-muted-foreground">
                        {(event.payload as { note?: string }).note ?? ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
