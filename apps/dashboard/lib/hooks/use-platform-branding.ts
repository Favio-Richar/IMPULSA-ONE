import { useQuery } from "@tanstack/react-query";
import { getPlatformBranding } from "../api/branding";

export function usePlatformBranding() {
  return useQuery({
    queryKey: ["platform-branding"],
    queryFn: getPlatformBranding,
    staleTime: 60 * 1000,
  });
}
