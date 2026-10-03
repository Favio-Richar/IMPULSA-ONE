"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
} from "@impulza/ui";
import type { BrandProfileResponse } from "@impulza/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AA_NORMAL_TEXT,
  contrastRatio,
  type BrandingTarget,
  type UpdateBrandProfileDto,
} from "@impulza/validation";
import { useState } from "react";
import { useActiveOrgStore } from "@/lib/active-org-store";
import { ApiError } from "@/lib/api-client";
import {
  getOrgBrandProfile,
  updateOrgBrandProfile,
  uploadOrgBrandProfileAsset,
} from "@/lib/api/brand-profile";

interface BrandProfileFormProps {
  organizationId: string;
  initialData: BrandProfileResponse;
}

function BrandProfileForm({ organizationId, initialData }: BrandProfileFormProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [uploadingTarget, setUploadingTarget] = useState<BrandingTarget | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    displayName: initialData.displayName ?? "",
    primaryColor: initialData.primaryColor ?? "",
    secondaryColor: initialData.secondaryColor ?? "",
    contactEmail: initialData.contactEmail ?? "",
    contactPhone: initialData.contactPhone ?? "",
    legalName: initialData.legalName ?? "",
    taxId: initialData.taxId ?? "",
    logoLightUrl: initialData.logoLightUrl ?? "",
    logoDarkUrl: initialData.logoDarkUrl ?? "",
    faviconUrl: initialData.faviconUrl ?? "",
  });

  const primaryContrast = form.primaryColor ? contrastRatio(form.primaryColor, "#ffffff") : null;
  const isPrimaryPass = primaryContrast === null || primaryContrast >= AA_NORMAL_TEXT;

  const secondaryContrast = form.secondaryColor ? contrastRatio(form.secondaryColor, "#ffffff") : null;
  const isSecondaryPass = secondaryContrast === null || secondaryContrast >= AA_NORMAL_TEXT;

  const updateMutation = useMutation({
    mutationFn: (body: UpdateBrandProfileDto) => updateOrgBrandProfile(organizationId, body),
    onSuccess: (updated) => {
      setSuccessMessage("Configuración de marca guardada correctamente.");
      setErrorMessage(null);
      queryClient.setQueryData(["org-brand-profile", organizationId], updated);
      void queryClient.invalidateQueries({ queryKey: ["org-brand-profile", organizationId] });
    },
    onError: (err: unknown) => {
      setSuccessMessage(null);
      if (err instanceof ApiError && err.status === 400) {
        setErrorMessage("Datos inválidos. Revisa los colores (contraste WCAG AA) y los campos marcados.");
      } else {
        setErrorMessage("No pudimos guardar la configuración de marca. Intenta de nuevo.");
      }
    },
  });

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: BrandingTarget,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingTarget(target);
    setErrorMessage(null);
    try {
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await uploadOrgBrandProfileAsset(organizationId, {
        target,
        fileName: file.name,
        contentType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
        sizeBytes: file.size,
        base64Data,
      });

      if (target === "logo_light") setForm((prev) => ({ ...prev, logoLightUrl: result.url }));
      if (target === "logo_dark") setForm((prev) => ({ ...prev, logoDarkUrl: result.url }));
      if (target === "favicon") setForm((prev) => ({ ...prev, faviconUrl: result.url }));
    } catch {
      setErrorMessage("No se pudo subir la imagen. Verifica que sea PNG, JPG, WebP o SVG válido.");
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!isPrimaryPass || !isSecondaryPass) {
      setErrorMessage("Los colores de marca deben cumplir con contraste WCAG 2.2 AA (≥ 4.5:1 sobre blanco).");
      return;
    }

    setSuccessMessage(null);
    setErrorMessage(null);

    const payload: UpdateBrandProfileDto = {
      displayName: form.displayName.trim() || null,
      primaryColor: form.primaryColor.trim() || null,
      secondaryColor: form.secondaryColor.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      legalName: form.legalName.trim() || null,
      taxId: form.taxId.trim() || null,
      logoLightUrl: form.logoLightUrl.trim() || null,
      logoDarkUrl: form.logoDarkUrl.trim() || null,
      faviconUrl: form.faviconUrl.trim() || null,
    };

    updateMutation.mutate(payload);
  };

  return (
    <div className="space-y-6" data-testid="brand-form">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Marca de la organización</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Personaliza la identidad visual de tu negocio. Los colores deben tener contraste WCAG 2.2 AA
          (≥ 4.5:1 sobre fondo claro).
        </p>
      </div>

      <form noValidate className="space-y-6" onSubmit={handleSubmit}>
        {/* Vista previa */}
        {(form.displayName || form.primaryColor || form.logoLightUrl) && (
          <Card>
            <CardHeader>
              <CardTitle>Vista previa</CardTitle>
              <CardDescription>Cómo se muestra la identidad en la cabecera y correos.</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="flex items-center gap-3 rounded-lg border border-border p-4"
                style={{ borderColor: form.primaryColor || undefined }}
              >
                {form.logoLightUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoLightUrl} alt="Logo" className="h-10 object-contain" />
                ) : null}
                <span
                  className="text-base font-semibold"
                  style={{ color: form.primaryColor || undefined }}
                >
                  {form.displayName || "Tu negocio"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Identidad */}
        <Card>
          <CardHeader>
            <CardTitle>Identidad</CardTitle>
            <CardDescription>Nombre visible y logotipos de tu negocio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Nombre visible"
              placeholder="Ej. Mi Negocio"
              value={form.displayName}
              onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="brand-logo-light" className="text-sm font-medium text-foreground">Logo (fondo claro)</label>
                <input
                  id="brand-logo-light"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  disabled={uploadingTarget !== null}
                  onChange={(e) => void handleFileUpload(e, "logo_light")}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                />
                {form.logoLightUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logoLightUrl}
                    alt="Logo claro"
                    className="h-12 rounded border border-border object-contain p-1"
                  />
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="brand-logo-dark" className="text-sm font-medium text-foreground">Logo (fondo oscuro)</label>
                <input
                  id="brand-logo-dark"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  disabled={uploadingTarget !== null}
                  onChange={(e) => void handleFileUpload(e, "logo_dark")}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                />
                {form.logoDarkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logoDarkUrl}
                    alt="Logo oscuro"
                    className="h-12 rounded border border-border bg-gray-900 object-contain p-1"
                  />
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="brand-favicon" className="text-sm font-medium text-foreground">Favicon</label>
              <input
                id="brand-favicon"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={uploadingTarget !== null}
                onChange={(e) => void handleFileUpload(e, "favicon")}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              />
              {form.faviconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.faviconUrl}
                  alt="Favicon"
                  className="h-8 w-8 rounded border border-border object-contain"
                />
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Colores */}
        <Card>
          <CardHeader>
            <CardTitle>Colores de marca</CardTitle>
            <CardDescription>WCAG 2.2 AA exige al menos 4.5:1 sobre fondo claro (#ffffff).</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="primaryColor" className="text-sm font-medium text-foreground">
                Color primario
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  id="primaryColor"
                  value={form.primaryColor || "#0f6f6b"}
                  onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                  className="h-10 w-12 cursor-pointer rounded border border-border p-1"
                />
                <Input
                  label="Código hexadecimal"
                  placeholder="#0f6f6b"
                  value={form.primaryColor}
                  onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                />
              </div>
              {primaryContrast !== null ? (
                <p className={`text-xs ${isPrimaryPass ? "text-success" : "text-danger"}`}>
                  Contraste: {primaryContrast.toFixed(2)}:1 ({isPrimaryPass ? "Pasa AA" : "Rechazado < 4.5:1"})
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="secondaryColor" className="text-sm font-medium text-foreground">
                Color secundario
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  id="secondaryColor"
                  value={form.secondaryColor || "#0b5450"}
                  onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                  className="h-10 w-12 cursor-pointer rounded border border-border p-1"
                />
                <Input
                  label="Código hexadecimal"
                  placeholder="#0b5450"
                  value={form.secondaryColor}
                  onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                />
              </div>
              {secondaryContrast !== null ? (
                <p className={`text-xs ${isSecondaryPass ? "text-success" : "text-danger"}`}>
                  Contraste: {secondaryContrast.toFixed(2)}:1 ({isSecondaryPass ? "Pasa AA" : "Rechazado < 4.5:1"})
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Contacto y legal */}
        <Card>
          <CardHeader>
            <CardTitle>Contacto y datos legales</CardTitle>
            <CardDescription>Datos públicos opcionales de tu negocio.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Correo de contacto"
              type="email"
              placeholder="contacto@ejemplo.com"
              value={form.contactEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, contactEmail: e.target.value }))}
            />
            <Input
              label="Teléfono de contacto"
              placeholder="+56 9 1234 5678"
              value={form.contactPhone}
              onChange={(e) => setForm((prev) => ({ ...prev, contactPhone: e.target.value }))}
            />
            <Input
              label="Razón social"
              placeholder="Mi Empresa S.A."
              value={form.legalName}
              onChange={(e) => setForm((prev) => ({ ...prev, legalName: e.target.value }))}
            />
            <Input
              label="RUT / ID tributario"
              placeholder="76.123.456-7"
              value={form.taxId}
              onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))}
            />
          </CardContent>
        </Card>

        {errorMessage ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p role="status" className="text-sm text-success">
            {successMessage}
          </p>
        ) : null}

        <Button
          type="submit"
          loading={updateMutation.isPending || uploadingTarget !== null}
          disabled={!isPrimaryPass || !isSecondaryPass}
        >
          Guardar cambios de marca
        </Button>
      </form>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function MarcaPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["org-brand-profile", activeOrganizationId],
    queryFn: () => getOrgBrandProfile(activeOrganizationId!),
    enabled: Boolean(activeOrganizationId),
  });

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para administrar su marca."
      />
    );
  }

  if (isLoading) {
    return <LoadingState label="Cargando marca de la organización…" />;
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="No pudimos cargar la marca de la organización"
        description="Verifica la conexión con el servidor e intenta de nuevo."
        onRetry={() => refetch()}
      />
    );
  }

  return <BrandProfileForm organizationId={activeOrganizationId} initialData={data} />;
}
