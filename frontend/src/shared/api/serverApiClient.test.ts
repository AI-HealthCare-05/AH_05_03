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

  it("가족 초대와 프로필 연결에는 불투명 참조값만 전송한다", async () => {
    const reference = "A".repeat(43);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success({ access_token: "access", token_type: "bearer", expires_in: 900 }))
      .mockResolvedValueOnce(success({ invitation: { id: "invitation-id" }, delivery_queued: true }))
      .mockResolvedValueOnce(success({ id: "link-id", local_profile_ref: reference }));
    const client = new ServerApiClient(fetcher);
    await client.login("member@example.com", "Password123!");
    await client.createInvitation({
      householdId: "household-id",
      inviteeEmail: "family@example.com",
      targetProfileRef: reference,
    });
    await client.createProfileLink("invitation-id", reference);

    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      household_id: "household-id",
      invitee_email: "family@example.com",
      target_profile_ref: reference,
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      invitation_id: "invitation-id",
      local_profile_ref: reference,
    });
  });

  it("204 No Content 응답을 JSON 파싱 없이 처리한다", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success({ access_token: "access", token_type: "bearer", expires_in: 900 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ServerApiClient(fetcher);
    await client.login("member@example.com", "Password123!");

    await expect(client.closeHousehold("household-id")).resolves.toBeUndefined();
  });
});
