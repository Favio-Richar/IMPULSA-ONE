"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AvailabilityPreview } from "../../../../../components/bookings/availability-preview";
import { BookableServices } from "../../../../../components/bookings/bookable-services";
import { BookingBlackouts } from "../../../../../components/bookings/booking-blackouts";
import { BookingBranches } from "../../../../../components/bookings/booking-branches";
import { BookingSettingsForm } from "../../../../../components/bookings/booking-settings-form";
import { BookingStaff } from "../../../../../components/bookings/booking-staff";
import { CalendarSync } from "../../../../../components/bookings/calendar-sync";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useBookableServices, useBookingSettings } from "../../../../../lib/hooks/use-booking-setup";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Reservas del sitio (F5.1): horario, servicios, días bloqueados y la vista previa de horarios.

export default function ReservasPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para configurar sus reservas." />;
  }
  return <BookingSetup organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function BookingSetup({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);
  const settingsQuery = useBookingSettings(organizationId, siteId);
  const servicesQuery = useBookableServices(organizationId, siteId);

  if (siteQuery.isPending || settingsQuery.isPending) {
    return <LoadingState label="Cargando reservas…" />;
  }
  if (siteQuery.isError || settingsQuery.isError) {
    const error = siteQuery.error ?? settingsQuery.error;
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return (
      <ErrorState
        onRetry={() => {
          void siteQuery.refetch();
          void settingsQuery.refetch();
        }}
      />
    );
  }

  const settings = settingsQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/sitios/${siteId}`} className="text-sm text-muted-foreground hover:underline">
          ← {siteQuery.data.name}
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-foreground">Reservas</h1>
        <p className="text-sm text-muted-foreground">
          Define cuándo atiendes y qué se puede reservar. Tus clientes eligen el día y la hora desde tu página.
        </p>
      </div>

      {/* El formulario toma la configuración una vez al montar y conserva lo que se escribe. */}
      <BookingSettingsForm organizationId={organizationId} siteId={siteId} settings={settings} />
      <BookingBranches organizationId={organizationId} siteId={siteId} />
      <BookingStaff organizationId={organizationId} siteId={siteId} />
      <BookableServices organizationId={organizationId} siteId={siteId} />
      <BookingBlackouts organizationId={organizationId} siteId={siteId} timeZone={settings.timeZone} />
      <CalendarSync organizationId={organizationId} siteId={siteId} settings={settings} />
      {servicesQuery.data ? (
        <AvailabilityPreview organizationId={organizationId} siteId={siteId} timeZone={settings.timeZone} services={servicesQuery.data} />
      ) : null}
    </div>
  );
}
