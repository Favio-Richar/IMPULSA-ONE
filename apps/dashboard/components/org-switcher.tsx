"use client";

import { useEffect } from "react";
import { useActiveOrgStore } from "../lib/active-org-store";
import type { Organization } from "../lib/api/organizations";

export function OrgSwitcher({ organizations }: { organizations: Organization[] }): React.JSX.Element | null {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const setActiveOrganizationId = useActiveOrgStore((state) => state.setActiveOrganizationId);

  useEffect(() => {
    const stillValid = organizations.some((org) => org.id === activeOrganizationId);
    if (!stillValid) {
      setActiveOrganizationId(organizations[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizations]);

  if (organizations.length === 0) {
    return null;
  }

  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="sr-only">Organización activa</span>
      <select
        className="h-9 w-full min-w-0 max-w-xs truncate rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        value={activeOrganizationId ?? ""}
        onChange={(event) => setActiveOrganizationId(event.target.value)}
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}
