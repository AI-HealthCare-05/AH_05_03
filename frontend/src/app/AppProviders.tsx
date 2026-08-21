import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router-dom";

import { LocalDomainProvider } from "./LocalDomainProvider";
import { router } from "./router";

export function AppProviders() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LocalDomainProvider>
        <RouterProvider router={router} />
      </LocalDomainProvider>
    </QueryClientProvider>
  );
}
