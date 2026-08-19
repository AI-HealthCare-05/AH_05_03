import { describe, expect, it, vi } from "vitest";

import { ServerApiClient } from "./serverApiClient";

function success<T>(data: T): Response {
  return Response.json({ data, message: "ok", success: true });
}

describe("ServerApiClient", () => {
  it("Access Token은 메모리에만 두고 인증 요청의 Bearer 헤더로 전달한다", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        success({ access_token: "access-one", token_type: "bearer", expires_in: 900 }),
      )
      .mockResolvedValueOnce(
        success({
          account: {
            id: "account-id",
            email: "member@example.com",
            status: "active",
            created_at: "2026-08-19T00:00:00Z",
          },
          subscription: { plan: "FREE", status: "active", renewed_at: null },
        }),
      );
    const client = new ServerApiClient(fetcher);

    await client.login("member@example.com", "Password123!");
    await client.getAccount();

    const loginRequest = fetcher.mock.calls[0]?.[1];
    const accountRequest = fetcher.mock.calls[1]?.[1];
    expect(new Headers(loginRequest?.headers).has("Authorization")).toBe(false);
    expect(new Headers(accountRequest?.headers).get("Authorization")).toBe("Bearer access-one");
    expect(accountRequest?.credentials).toBe("include");
  });

  it("새로고침 뒤에는 HttpOnly refresh 쿠키로 Access Token을 한 번 복구한다", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        success({ access_token: "restored-access", token_type: "bearer", expires_in: 900 }),
      )
      .mockResolvedValueOnce(success({ items: [] }));
    const client = new ServerApiClient(fetcher);

    await client.listHouseholds();

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/refresh");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/households");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer restored-access",
    );
  });

  it("오류 봉투의 error_code와 필드 상세를 보존한다", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error_code: "VALIDATION_ERROR",
          message: "입력값을 확인해 주세요.",
          success: false,
          details: [{ field: "email", message: "invalid", type: "value_error" }],
        },
        { status: 422 },
      ),
    );
    const client = new ServerApiClient(fetcher);

    const promise = client.signUp("invalid", "Password123!");

    await expect(promise).rejects.toMatchObject({
      status: 422,
      errorCode: "VALIDATION_ERROR",
      details: [{ field: "email", message: "invalid", type: "value_error" }],
    });
  });
});
