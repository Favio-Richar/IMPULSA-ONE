"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, LoadingState } from "@impulza/ui";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { verifyEmail } from "../../../lib/api/auth";

function VerifyEmailContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const attempted = useRef(false);

  const mutation = useMutation({ mutationFn: verifyEmail });

  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      mutation.mutate(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return <CardDescription>Falta el código de verificación en el enlace.</CardDescription>;
  }
  if (mutation.isPending) {
    return <LoadingState label="Verificando tu correo…" />;
  }
  if (mutation.isSuccess) {
    return (
      <div className="flex flex-col gap-3">
        <CardDescription>Tu correo quedó verificado.</CardDescription>
        <Button asChild>
          <Link href="/login">Iniciar sesión</Link>
        </Button>
      </div>
    );
  }
  return (
    <CardDescription>
      El enlace es inválido o ya expiró. Vuelve a solicitar la verificación desde tu cuenta.
    </CardDescription>
  );
}

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verificación de correo</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<LoadingState />}>
            <VerifyEmailContent />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
