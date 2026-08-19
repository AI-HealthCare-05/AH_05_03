import { useQuery } from "@tanstack/react-query";

interface ApiEnvelope<T> {
  data: T;
  message: string;
}

export interface AccountSummary {
  account: {
    id: string;
    email: string;
    status: string;
    created_at: string;
  };
  subscription: {
    plan: string;
    status: string;
    renewed_at: string | null;
  };
}

async function getAccountSummary(): Promise<AccountSummary> {
  const response = await fetch("/api/v1/account", {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("서비스 계정 메타데이터를 불러오지 못했습니다.");
  }

  const body = (await response.json()) as ApiEnvelope<AccountSummary>;
  return body.data;
}

export function useAccountSummaryQuery() {
  return useQuery({
    queryKey: ["service-metadata", "account"],
    queryFn: getAccountSummary,
    enabled: false,
  });
}
