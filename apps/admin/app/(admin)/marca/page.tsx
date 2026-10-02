"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  LoadingState,
  Textarea,
  cn,
} from "@impulza/ui";
import type { PlatformBrandingResponse } from "@impulza/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  Palette,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import React, { useState } from "react";
import { PageHeader } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { contrastRatio, AA_NORMAL_TEXT } from "@impulza/validation";
import type { UpdatePlatformBrandingDto, BrandingTarget } from "@impulza/validation";

export default function AdminMarcaPage(): React.JSX.Element {
  const brandingQuery = useQuery({
    queryKey: ["admin", "platform-branding"],
    queryFn: adminApi.getPlatformBranding,
  });

  if (brandingQuery.isPending) {
    return <LoadingState label="Cargando configuración de marca…" />;
  }

  if (brandingQuery.isError || !brandingQuery.data) {
    return (
      <ErrorState
        title="No pudimos cargar la marca de la plataforma"
        description="Verifica la conexión con el servidor e intenta de nuevo."
        onRetry={() => brandingQuery.refetch()}
      />
    );
  }

  return (
    <PlatformBrandingForm initialBranding={brandingQuery.data} />
  );
}

function PlatformBrandingForm({
  initialBranding,
}: {
  initialBranding: PlatformBrandingResponse;
}): React.JSX.Element {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<UpdatePlatformBrandingDto>(() => ({
    name: initialBranding.name,
    logoLightUrl: initialBranding.logoLightUrl ?? "",
    logoDarkUrl: initialBranding.logoDarkUrl ?? "",
    faviconUrl: initialBranding.faviconUrl ?? "",
    primaryColor: initialBranding.primaryColor,
    secondaryColor: initialBranding.secondaryColor,
    senderName: initialBranding.senderName,
    senderEmail: initialBranding.senderEmail,
    supportUrl: initialBranding.supportUrl ?? "",
    privacyUrl: initialBranding.privacyUrl ?? "",
    termsUrl: initialBranding.termsUrl ?? "",
    footerText: initialBranding.footerText ?? "",
  }));

  const [confirmReset, setConfirmReset] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadingTarget, setUploadingTarget] = useState<BrandingTarget | null>(null);

  const updateMutation = useMutation({
    mutationFn: (body: UpdatePlatformBrandingDto) => adminApi.updatePlatformBranding(body),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "platform-branding"], data);
      setSuccessMessage("Configuración de marca guardada y aplicada correctamente.");
      setErrorMessage(null);
      setTimeout(() => setSuccessMessage(null), 4000);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error al actualizar la marca.";
      setErrorMessage(msg);
      setSuccessMessage(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: adminApi.resetPlatformBranding,
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "platform-branding"], data);
      setForm({
        name: data.name,
        logoLightUrl: data.logoLightUrl ?? "",
        logoDarkUrl: data.logoDarkUrl ?? "",
        faviconUrl: data.faviconUrl ?? "",
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        senderName: data.senderName,
        senderEmail: data.senderEmail,
        supportUrl: data.supportUrl ?? "",
        privacyUrl: data.privacyUrl ?? "",
        termsUrl: data.termsUrl ?? "",
        footerText: data.footerText ?? "",
      });
      setConfirmReset(false);
      setSuccessMessage("Marca de la plataforma restablecida a los valores por defecto de Impulza One.");
      setErrorMessage(null);
      setTimeout(() => setSuccessMessage(null), 4000);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error al restablecer la marca.";
      setErrorMessage(msg);
      setSuccessMessage(null);
    },
  });

  const handleFileUpload = async (target: BrandingTarget, file: File) => {
    try {
      setUploadingTarget(target);
      setErrorMessage(null);

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const uploadRes = await adminApi.uploadPlatformBrandingAsset({
        target,
        fileName: file.name,
        contentType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
        sizeBytes: file.size,
        base64Data,
      });

      if (target === "logo_light") {
        setForm((prev) => ({ ...prev, logoLightUrl: uploadRes.url }));
      } else if (target === "logo_dark") {
        setForm((prev) => ({ ...prev, logoDarkUrl: uploadRes.url }));
      } else if (target === "favicon") {
        setForm((prev) => ({ ...prev, faviconUrl: uploadRes.url }));
      }

      setSuccessMessage("Archivo subido correctamente. Haz clic en 'Guardar cambios' para aplicar.");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error al subir el archivo.");
    } finally {
      setUploadingTarget(null);
    }
  };

  const primaryContrast = contrastRatio(form.primaryColor || "#0f6f6b", "#ffffff");
  const secondaryContrast = contrastRatio(form.secondaryColor || "#0b5450", "#ffffff");
  const primaryMeetsAa = primaryContrast >= AA_NORMAL_TEXT;
  const secondaryMeetsAa = secondaryContrast >= AA_NORMAL_TEXT;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name: form.name.trim(),
      logoLightUrl: form.logoLightUrl?.trim() || null,
      logoDarkUrl: form.logoDarkUrl?.trim() || null,
      faviconUrl: form.faviconUrl?.trim() || null,
      primaryColor: form.primaryColor.trim(),
      secondaryColor: form.secondaryColor.trim(),
      senderName: form.senderName.trim(),
      senderEmail: form.senderEmail.trim(),
      supportUrl: form.supportUrl?.trim() || null,
      privacyUrl: form.privacyUrl?.trim() || null,
      termsUrl: form.termsUrl?.trim() || null,
      footerText: form.footerText?.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marca de la plataforma"
        description="Configura la identidad global del producto (logo, colores, remitente y enlaces legales). Se propaga al sitio comercial, correos y paneles."
        actions={
          confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">¿Restablecer todo a Impulza One?</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
              >
                {resetMutation.isPending ? "Restableciendo…" : "Confirmar restablecer"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Restablecer a la marca por defecto
            </Button>
          )
        }
      />

      {successMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Formulario de configuración (7 columnas) */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6 lg:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Identidad básica</CardTitle>
              <CardDescription>Nombre oficial del sistema y descripción de pie de página.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                label="Nombre de la plataforma"
                id="branding-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Impulza One"
                required
              />

              <Textarea
                label="Texto de pie de página (resumen)"
                id="branding-footer"
                value={form.footerText ?? ""}
                onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                rows={2}
                placeholder="Descripción breve que aparece en el pie del sitio comercial."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Paleta de colores y accesibilidad (WCAG 2.2 AA)</CardTitle>
              <CardDescription>
                El servidor exige un contraste mínimo de 4.5:1 sobre fondo claro (#ffffff) para garantizar legibilidad.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-foreground">Color</span>
                    <input
                      type="color"
                      id="branding-primary"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="size-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                      aria-label="Selector de color primario"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      label="Color primario (acciones)"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="font-mono text-sm"
                      pattern="^#[0-9a-fA-F]{6}$"
                      required
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium",
                      primaryMeetsAa ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
                    )}
                  >
                    Contraste: {primaryContrast.toFixed(2)}:1
                    {primaryMeetsAa ? " (Pasa AA)" : " (Rechazado < 4.5:1)"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-foreground">Color</span>
                    <input
                      type="color"
                      id="branding-secondary"
                      value={form.secondaryColor}
                      onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                      className="size-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                      aria-label="Selector de color secundario"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      label="Color secundario (superficies)"
                      value={form.secondaryColor}
                      onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                      className="font-mono text-sm"
                      pattern="^#[0-9a-fA-F]{6}$"
                      required
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium",
                      secondaryMeetsAa ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
                    )}
                  >
                    Contraste: {secondaryContrast.toFixed(2)}:1
                    {secondaryMeetsAa ? " (Pasa AA)" : " (Rechazado < 4.5:1)"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Logotipos e isotipos</CardTitle>
              <CardDescription>
                PNG, JPG, WebP o SVG saneado sin scripts. Si no hay archivo cargado, el sistema genera el isotipo con las iniciales.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Logo fondo claro */}
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Logotipo para fondo claro</span>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg"
                      className="sr-only"
                      disabled={uploadingTarget !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("logo_light", file);
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-hover">
                      <Upload className="size-3" />
                      {uploadingTarget === "logo_light" ? "Subiendo…" : "Subir archivo"}
                    </span>
                  </label>
                </div>
                <Input
                  label="URL del logotipo (fondo claro)"
                  value={form.logoLightUrl ?? ""}
                  onChange={(e) => setForm({ ...form, logoLightUrl: e.target.value })}
                  placeholder="https://… o vacío para usar iniciales"
                  className="text-xs"
                />
              </div>

              {/* Logo fondo oscuro */}
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Logotipo para fondo oscuro</span>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg"
                      className="sr-only"
                      disabled={uploadingTarget !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("logo_dark", file);
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-hover">
                      <Upload className="size-3" />
                      {uploadingTarget === "logo_dark" ? "Subiendo…" : "Subir archivo"}
                    </span>
                  </label>
                </div>
                <Input
                  label="URL del logotipo (fondo oscuro)"
                  value={form.logoDarkUrl ?? ""}
                  onChange={(e) => setForm({ ...form, logoDarkUrl: e.target.value })}
                  placeholder="https://… o vacío para usar iniciales"
                  className="text-xs"
                />
              </div>

              {/* Favicon */}
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Favicon del navegador</span>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".png,.ico,.webp,.svg"
                      className="sr-only"
                      disabled={uploadingTarget !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("favicon", file);
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-hover">
                      <Upload className="size-3" />
                      {uploadingTarget === "favicon" ? "Subiendo…" : "Subir favicon"}
                    </span>
                  </label>
                </div>
                <Input
                  label="URL del favicon"
                  value={form.faviconUrl ?? ""}
                  onChange={(e) => setForm({ ...form, faviconUrl: e.target.value })}
                  placeholder="https://… o vacío"
                  className="text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Remitente de correos transaccionales</CardTitle>
              <CardDescription>
                Aparece como emisor en los correos de verificación, restablecimiento de contraseña y avisos de soporte.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Nombre visible del remitente"
                id="branding-sender-name"
                value={form.senderName}
                onChange={(e) => setForm({ ...form, senderName: e.target.value })}
                placeholder="Ej. Impulza One"
                required
              />
              <Input
                label="Dirección de correo remitente"
                id="branding-sender-email"
                type="email"
                value={form.senderEmail}
                onChange={(e) => setForm({ ...form, senderEmail: e.target.value })}
                placeholder="notificaciones@impulza.app"
                required
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. Enlaces de soporte y legales</CardTitle>
              <CardDescription>Deben ser enlaces seguros con https://.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                label="Centro de ayuda o soporte"
                id="branding-support-url"
                value={form.supportUrl ?? ""}
                onChange={(e) => setForm({ ...form, supportUrl: e.target.value })}
                placeholder="https://impulza.app/soporte"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Términos del servicio"
                  id="branding-terms-url"
                  value={form.termsUrl ?? ""}
                  onChange={(e) => setForm({ ...form, termsUrl: e.target.value })}
                  placeholder="https://impulza.app/terminos"
                />
                <Input
                  label="Política de privacidad"
                  id="branding-privacy-url"
                  value={form.privacyUrl ?? ""}
                  onChange={(e) => setForm({ ...form, privacyUrl: e.target.value })}
                  placeholder="https://impulza.app/privacidad"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="submit"
              disabled={updateMutation.isPending || !primaryMeetsAa || !secondaryMeetsAa}
              className="w-full sm:w-auto"
            >
              {updateMutation.isPending ? "Guardando cambios…" : "Guardar cambios de marca"}
            </Button>
          </div>
        </form>

        {/* Vista previa en vivo (5 columnas) */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card className="sticky top-6">
            <CardHeader className="border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <CardTitle className="text-base">Vista previa en tiempo real</CardTitle>
              </div>
              <CardDescription>Cómo se visualiza tu marca en las aplicaciones y correos.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-4">
              {/* Encabezado web fondo claro */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Cabecera (Fondo claro)
                </span>
                <div className="flex items-center justify-between rounded-lg border border-border bg-white p-3 shadow-xs">
                  <div className="flex items-center gap-2">
                    {form.logoLightUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.logoLightUrl} alt="Logo claro" className="h-7 w-auto object-contain" />
                    ) : (
                      <span
                        className="flex size-7 items-center justify-center rounded-[6px] text-xs font-bold text-white shadow-xs"
                        style={{ backgroundColor: form.primaryColor }}
                      >
                        {form.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="font-semibold text-sm text-[#0f172a]">{form.name || "Impulza One"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-[6px] px-2.5 py-1 text-xs font-medium text-white shadow-xs"
                      style={{ backgroundColor: form.primaryColor }}
                    >
                      Empezar gratis
                    </span>
                  </div>
                </div>
              </div>

              {/* Panel fondo oscuro */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Panel / Mosaico (Fondo oscuro)
                </span>
                <div
                  className="flex items-center justify-between rounded-lg p-3 text-white shadow-sm"
                  style={{ backgroundColor: form.primaryColor }}
                >
                  <div className="flex items-center gap-2">
                    {form.logoDarkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.logoDarkUrl} alt="Logo oscuro" className="h-7 w-auto object-contain" />
                    ) : (
                      <span className="flex size-7 items-center justify-center rounded-[6px] bg-white/20 text-xs font-bold text-white">
                        {form.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="font-semibold text-sm">{form.name || "Impulza One"}</span>
                  </div>
                  <span className="rounded bg-white/15 px-2 py-0.5 text-[11px] text-white/90">Acceso</span>
                </div>
              </div>

              {/* Mock de correo transaccional */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Correo transaccional
                </span>
                <div className="flex flex-col rounded-lg border border-border bg-surface/50 p-3 text-xs shadow-xs">
                  <div className="border-b border-border/60 pb-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="size-3" />
                      <span>De: </span>
                      <strong className="text-foreground">{form.senderName}</strong>
                      <span className="text-[11px]">(&lt;{form.senderEmail}&gt;)</span>
                    </div>
                    <p className="mt-1 font-medium text-foreground">Asunto: Verifica tu correo — {form.name}</p>
                  </div>
                  <div className="py-3 text-muted-foreground">
                    <p>Hola,</p>
                    <p className="mt-1">
                      Confirma tu correo para activar tu cuenta en <strong>{form.name}</strong>.
                    </p>
                    <div className="my-2">
                      <span
                        className="inline-block rounded px-3 py-1 text-[11px] font-semibold text-white"
                        style={{ backgroundColor: form.primaryColor }}
                      >
                        Confirmar mi correo
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground/80">
                    <p>{form.footerText}</p>
                    <div className="mt-1 flex gap-2 text-[10px] text-primary">
                      {form.termsUrl ? <span>Términos</span> : null}
                      {form.privacyUrl ? <span>Privacidad</span> : null}
                      {form.supportUrl ? <span>Ayuda</span> : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Estado de accesibilidad */}
              <div className="rounded-lg border border-border bg-surface p-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Palette className="size-3.5 text-primary" />
                  <span>Verificación de accesibilidad</span>
                </div>
                <div className="mt-2 flex flex-col gap-1 text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Primario sobre blanco:</span>
                    <strong className={primaryMeetsAa ? "text-success" : "text-danger"}>
                      {primaryContrast.toFixed(2)}:1 {primaryMeetsAa ? "✓" : "✗"}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Secundario sobre blanco:</span>
                    <strong className={secondaryMeetsAa ? "text-success" : "text-danger"}>
                      {secondaryContrast.toFixed(2)}:1 {secondaryMeetsAa ? "✓" : "✗"}
                    </strong>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
