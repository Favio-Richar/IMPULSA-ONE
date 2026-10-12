"use client";

import { createContext, useContext } from "react";

/** Una página del sitio que se puede elegir como destino de un botón o tarjeta. */
export interface PageOption {
  slug: string;
  title: string;
  isHome: boolean;
}

const PageOptionsContext = createContext<readonly PageOption[]>([]);

export const PageOptionsProvider = PageOptionsContext.Provider;

/** Las páginas del sitio que se está editando (vacío fuera del constructor). */
export function usePageOptions(): readonly PageOption[] {
  return useContext(PageOptionsContext);
}
