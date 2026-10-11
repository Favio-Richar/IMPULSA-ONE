"use client";

import { useState } from "react";

/** Salida discreta del miembro (F10.1): revoca la sesión en el servidor, borra la cookie y recarga la página. */
export function MemberSignOut({ siteSlug }: { siteSlug: string }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch(`/api/members/logout/${encodeURIComponent(siteSlug)}`, { method: "POST" });
    } finally {
      window.location.reload();
    }
  }

  return (
    <div className="flex justify-end px-4 pt-3">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="text-xs text-[var(--site-color-muted-foreground)] underline underline-offset-2 hover:text-[var(--site-color-foreground)] disabled:opacity-60"
      >
        {pending ? "Saliendo…" : "Salir de mi acceso"}
      </button>
    </div>
  );
}
