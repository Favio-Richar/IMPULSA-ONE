import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActiveOrgState {
  activeOrganizationId: string | null;
  setActiveOrganizationId: (id: string | null) => void;
}

// Un usuario puede pertenecer a varias organizaciones (F1.5) — cuál está activa es puramente
// estado de UI, no algo que el backend necesite saber (cada endpoint de organización valida
// membresía por su cuenta, sin importar qué haya "activo" en el cliente).
export const useActiveOrgStore = create<ActiveOrgState>()(
  persist(
    (set) => ({
      activeOrganizationId: null,
      setActiveOrganizationId: (id) => set({ activeOrganizationId: id }),
    }),
    { name: "impulza-active-org" },
  ),
);
