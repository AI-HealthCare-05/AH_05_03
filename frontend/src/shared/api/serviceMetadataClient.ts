import { useQuery } from "@tanstack/react-query";

import { serverApiClient } from "./serverApiClient";

export function useAccountSummaryQuery() {
  return useQuery({
    queryKey: ["service-metadata", "account"],
    queryFn: () => serverApiClient.getAccount(),
    enabled: false,
  });
}
