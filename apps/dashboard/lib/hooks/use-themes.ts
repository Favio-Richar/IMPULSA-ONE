import { useQuery } from "@tanstack/react-query";
import { listThemes } from "../api/themes";

export function useThemes(organizationId: string) {
  return useQuery({
    queryKey: ["themes", organizationId],
    queryFn: () => listThemes(organizationId),
  });
}
