"use client";

import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import { Clock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useContacts } from "../../../lib/hooks/use-contacts";

const COMMERCIAL_STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Calificado",
  WON: "Ganado",
  LOST: "Perdido",
};

const CONSENT_STATUS_LABEL: Record<string, string> = {
  GRANTED: "Otorgado",
  WITHDRAWN: "Retirado",
  UNKNOWN: "Sin declarar",
};

export default function ContactosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver sus contactos."
      />
    );
  }

  return <ContactsList organizationId={activeOrganizationId} />;
}

function ContactsList({ organizationId }: { organizationId: string }): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [commercialStatus, setCommercialStatus] = useState("");
  const [consentStatus, setConsentStatus] = useState("");
  const [retentionReview, setRetentionReview] = useState("");

  const contactsQuery = useContacts(organizationId, { search, tag, commercialStatus, consentStatus, retentionReview });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Contactos</h1>
        <Button asChild>
          <Link href="/contactos/nuevo">Agregar contacto</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          label="Buscar"
          placeholder="Nombre, correo o teléfono"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Input label="Etiqueta" placeholder="p. ej. vip" value={tag} onChange={(event) => setTag(event.target.value)} />
        <Select
          label="Estado comercial"
          placeholder="Todos"
          options={Object.entries(COMMERCIAL_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          value={commercialStatus}
          onChange={(event) => setCommercialStatus(event.target.value)}
        />
        <Select
          label="Consentimiento"
          placeholder="Todos"
          options={Object.entries(CONSENT_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          value={consentStatus}
          onChange={(event) => setConsentStatus(event.target.value)}
        />
        <Select
          label="Retención"
          placeholder="Todos"
          options={[{ value: "pending", label: "Por revisar (36 meses sin actividad)" }]}
          value={retentionReview}
          onChange={(event) => setRetentionReview(event.target.value)}
        />
      </div>

      {contactsQuery.isPending ? (
        <LoadingState label="Cargando contactos…" />
      ) : contactsQuery.isError ? (
        <ErrorState onRetry={() => contactsQuery.refetch()} />
      ) : contactsQuery.data.length === 0 ? (
        <EmptyState
          title="No hay contactos con estos filtros"
          description="Los envíos de formularios con consentimiento crean contactos automáticamente, o puedes agregar uno a mano."
          action={
            <Button asChild size="sm">
              <Link href="/contactos/nuevo">Agregar contacto</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Etiquetas</TableHead>
              <TableHead>Estado comercial</TableHead>
              <TableHead>Consentimiento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contactsQuery.data.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <Link href={`/contactos/${contact.id}`} className="font-medium text-primary hover:underline">
                    {contact.name ?? "(sin nombre)"}
                  </Link>
                  {contact.retentionReviewAt ? (
                    // Texto además del color: el estado nunca depende solo del color (WCAG).
                    <span className="ml-2 inline-flex items-center gap-1 rounded-sm border border-warning/40 px-1.5 py-0.5 text-xs text-foreground">
                      <Clock className="size-3 text-warning" aria-hidden="true" />
                      Revisar retención
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{contact.email ?? contact.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {contact.tags.length > 0 ? contact.tags.join(", ") : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {COMMERCIAL_STATUS_LABEL[contact.commercialStatus] ?? contact.commercialStatus}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {CONSENT_STATUS_LABEL[contact.consentStatus] ?? contact.consentStatus}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
