"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@impulza/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../../lib/api-client";
import { login } from "../../../lib/api/auth";
import { listMyOrganizations } from "../../../lib/api/organizations";

const loginFormSchema = z.object({
  email: z.email("Ingresa un correo válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

/**
 * Una cuenta recién creada (sin ninguna organización todavía) entra directo al asistente de bienvenida en vez de a un panel vacío.
 * Solo se decide al iniciar sesión: «Cancelar y volver al panel» del asistente sigue llevando al panel. Si la consulta falla,
 * se va al panel, que ya maneja ese error.
 */
async function landingAfterLogin(): Promise<string> {
  try {
    const organizations = await listMyOrganizations();
    return organizations.length === 0 ? "/bienvenida" : "/";
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginFormSchema) });

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setServerError(null);
    try {
      await login(values.email, values.password);
      router.push(await landingAfterLogin());
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        const body = error.body as { message?: string } | undefined;
        setServerError(body?.message ?? "No pudimos iniciar sesión.");
        return;
      }
      setServerError("Ocurrió un error inesperado. Intenta de nuevo.");
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Entra a tu panel de Impulza One.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <Input
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />
          {serverError ? (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" loading={isSubmitting} className="mt-2">
            Entrar
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          ¿No tienes cuenta?{" "}
          <Link href="/registro" className="font-medium text-primary hover:underline">
            Regístrate
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
