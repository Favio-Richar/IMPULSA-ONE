"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import { useAcceptOwnerInvitation } from "../../../../lib/hooks/use-agency";
import { useMe } from "../../../../lib/hooks/use-me";

/** La invitación se acepta con la cuenta cuyo correo es el invitado (ADR-028 §2): el servidor lo verifica. */
function InvitationContent(): React.JSX.Element {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const me = useMe();
  const accept = useAcceptOwnerInvitation();
  const setActiveOrganizationId = useActiveOrgStore((state) => state.setActiveOrganizationId);

  if (!token) {
    return <CardDescription>Falta el código de la invitación en el enlace.</CardDescription>;
  }
  if (me.isPending) {
    return <LoadingState label="Comprobando tu sesión…" />;
  }
  if (me.isError) {
    return (
      <div className="flex flex-col gap-3">
        <CardDescription>
          Para aceptar la invitación, inicia sesión —o crea tu cuenta— con el <strong>correo al que te llegó</strong>. Después vuelve a abrir el enlace del
          correo.
        </CardDescription>
        <Button asChild>
          <Link href="/login">Iniciar sesión</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/registro">Crear mi cuenta</Link>
        </Button>
      </div>
    );
  }

  if (accept.isSuccess) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <CardDescription>
          Listo: ahora eres el propietario de <strong>{accept.data.organizationName}</strong>. Tu agencia sigue trabajando con acceso delegado y puedes revocarlo
          cuando quieras en Configuración › Agencia.
        </CardDescription>
        <Button
          onClick={() => {
            setActiveOrganizationId(accept.data.organizationId);
            router.push("/");
          }}
        >
          Ir a mi panel
        </Button>
      </div>
    );
  }

  const status = accept.error instanceof ApiError ? accept.error.status : null;
  return (
    <div className="flex flex-col gap-3">
      <CardDescription>
        Estás conectado como <strong>{me.data.email}</strong>. Si este es el correo al que se envió la invitación, acéptala para quedar como propietario del negocio.
      </CardDescription>
      {accept.isError ? (
        <p role="alert" className="text-sm text-danger">
          {status === 410
            ? "La invitación venció. Pide a la agencia que te invite de nuevo."
            : "La invitación no existe, ya se usó o es para otra cuenta. Entra con el correo invitado."}
        </p>
      ) : null}
      <Button loading={accept.isPending} onClick={() => accept.mutate(token)}>
        Aceptar la invitación
      </Button>
    </div>
  );
}

export default function AgencyInvitationPage(): React.JSX.Element {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Invitación a administrar un negocio</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<LoadingState />}>
          <InvitationContent />
        </Suspense>
      </CardContent>
    </Card>
  );
}
