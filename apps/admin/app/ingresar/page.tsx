"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@impulza/ui";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../lib/api-client";
import { adminApi } from "../../lib/api";

const loginFormSchema = z.object({
  email: z.email("Ingresa un correo válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
  code: z.string().regex(/^\d{6}$/, "El código de tu app autenticadora tiene 6 dígitos."),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export default function AdminLoginPage(): React.JSX.Element {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginFormSchema) });

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setServerError(null);
    try {
      await adminApi.login(values);
      router.replace("/");
    } catch (error) {
      // Un código ya usado o vencido no sirve de nuevo: se limpia para pedir el siguiente.
      resetField("code");
      if (error instanceof ApiError && error.status === 429) {
        setServerError("Demasiados intentos. Espera unos minutos antes de volver a intentar.");
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setServerError(error.messageOr("No pudimos iniciar sesión."));
      } else {
        setServerError("No pudimos conectar con el servidor. Intenta de nuevo.");
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-foreground text-background">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-base font-semibold text-foreground">Administración de Impulza One</h1>
            <p className="text-sm text-muted-foreground">Acceso solo para el equipo de la plataforma.</p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input label="Correo electrónico" type="email" autoComplete="username" error={errors.email?.message} {...register("email")} />
          <Input
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />
          <Input
            label="Código de verificación"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            helperText="Los 6 dígitos de tu app autenticadora."
            error={errors.code?.message}
            {...register("code")}
          />
          {serverError ? (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" loading={isSubmitting} className="mt-1">
            Entrar
          </Button>
        </form>
      </div>
    </main>
  );
}
