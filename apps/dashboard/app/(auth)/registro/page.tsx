"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@impulza/ui";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../../lib/api-client";
import { register as registerAccount } from "../../../lib/api/auth";

const registerFormSchema = z.object({
  email: z.email("Ingresa un correo válido."),
  password: z.string().min(8, "Mínimo 8 caracteres."),
});

type RegisterFormValues = z.infer<typeof registerFormSchema>;

export default function RegisterPage() {
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerFormSchema) });

  async function onSubmit(values: RegisterFormValues): Promise<void> {
    setServerError(null);
    try {
      await registerAccount(values.email, values.password);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setServerError("Ya existe una cuenta con este correo.");
        return;
      }
      setServerError("Ocurrió un error inesperado. Intenta de nuevo.");
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Revisa tu correo</CardTitle>
            <CardDescription>
              Te enviamos un enlace para verificar tu cuenta. Ábrelo para poder iniciar sesión.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Crear cuenta</CardTitle>
          <CardDescription>Publica tu página profesional en minutos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Input
              label="Correo electrónico"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...registerField("email")}
            />
            <Input
              label="Contraseña"
              type="password"
              autoComplete="new-password"
              helperText={errors.password ? undefined : "Mínimo 8 caracteres."}
              error={errors.password?.message}
              {...registerField("password")}
            />
            {serverError ? (
              <p role="alert" className="text-sm text-danger">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" loading={isSubmitting} className="mt-2">
              Crear cuenta
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
