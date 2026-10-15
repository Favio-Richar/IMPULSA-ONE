"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { TemplateIntentCapture } from "../components/template-intent-capture";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Plantilla elegida en la galería pública del sitio comercial (`?plantilla=`). */}
      <TemplateIntentCapture />
      {children}
    </QueryClientProvider>
  );
}
