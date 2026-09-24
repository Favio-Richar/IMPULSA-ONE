"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Un 401 no se reintenta: la sesión venció y lo correcto es volver al login.
            retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status === 401),
            staleTime: 15_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
