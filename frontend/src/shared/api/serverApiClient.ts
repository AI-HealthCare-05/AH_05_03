import type {
  AccessTokenData,
  AccountCloseData,
  AccountSummary,
  ApiEnvelope,
  ApiErrorEnvelope,
  FamilyInvitationCreatedData,
  FamilyInvitationData,
  FamilyInvitationListData,
  HouseholdData,
  HouseholdMembershipData,
  HouseholdMembershipListItemData,
  PlanChangeData,
  ProfileLinkData,
  SignUpData,
  SubscriptionBrief,
  SubscriptionData,
} from "./contracts";

type FetchLike = typeof fetch;

interface RequestOptions extends RequestInit {
  authenticated?: boolean;
  retryAfterRefresh?: boolean;
}

export class ServerApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: ApiErrorEnvelope["details"],
  ) {
    super(message);
    this.name = "ServerApiError";
  }
}

export class ServerApiClient {
  private accessToken: string | undefined;
  private refreshPromise: Promise<AccessTokenData> | undefined;

  public constructor(
    private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api/v1",
  ) {}

  public async signUp(email: string, password: string): Promise<SignUpData> {
    return this.request("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  public async login(email: string, password: string): Promise<AccessTokenData> {
    const tokens = await this.request<AccessTokenData>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.accessToken = tokens.access_token;
    return tokens;
  }

  public async refresh(): Promise<AccessTokenData> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.request<AccessTokenData>("/auth/refresh", {
        method: "POST",
      })
        .then((tokens) => {
          this.accessToken = tokens.access_token;
          return tokens;
        })
        .finally(() => {
          this.refreshPromise = undefined;
        });
    }
    return this.refreshPromise;
  }

  public async logout(): Promise<void> {
    await this.request<null>("/auth/logout", {
      method: "POST",
      authenticated: true,
    });
    this.accessToken = undefined;
  }

  public getAccount(): Promise<AccountSummary> {
    return this.request("/account", { authenticated: true });
  }

  public closeAccount(): Promise<AccountCloseData> {
    return this.request("/account", { method: "DELETE", authenticated: true });
  }

  public getSubscription(): Promise<SubscriptionData> {
    return this.request("/subscription", { authenticated: true });
  }

  /**
   * 챌린지. 요청·응답 어디에도 측정값이 실리지 않는다 — 서버는 "쟀다" 와 날짜만 안다.
   */
  public getChallengeSettings<T>(): Promise<T> {
    return this.request<T>("/challenges/settings", { authenticated: true });
  }

  public saveChallengeSettings<T>(body: Record<string, unknown>): Promise<T> {
    return this.request<T>("/challenges/settings", {
      method: "PUT",
      authenticated: true,
      body: JSON.stringify(body),
    });
  }

  public getChallengeToday<T>(): Promise<T> {
    return this.request<T>("/challenges/today", { authenticated: true });
  }

  public checkChallenge<T>(challengeId: string): Promise<T> {
    return this.request<T>("/challenges/checks", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({ challenge_id: challengeId }),
    });
  }

  public uncheckChallenge<T>(challengeId: string): Promise<T> {
    return this.request<T>(`/challenges/checks/${encodeURIComponent(challengeId)}`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  public getHouseholdGarden<T>(householdId: string): Promise<T> {
    return this.request<T>(`/challenges/households/${encodeURIComponent(householdId)}`, {
      authenticated: true,
    });
  }

  public changeSubscription(plan: SubscriptionBrief["plan"]): Promise<PlanChangeData> {
    return this.request("/subscription/change", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({ plan }),
    });
  }

  public createHousehold(): Promise<HouseholdData> {
    return this.request("/households", { method: "POST", authenticated: true });
  }

  public async listHouseholds(): Promise<HouseholdData[]> {
    const result = await this.request<{ items: HouseholdData[] }>("/households", {
      authenticated: true,
    });
    return result.items;
  }

  public getHousehold(householdId: string): Promise<HouseholdData> {
    return this.request(`/households/${encodeURIComponent(householdId)}`, { authenticated: true });
  }

  public async listHouseholdMemberships(householdId: string): Promise<HouseholdMembershipListItemData[]> {
    const result = await this.request<{ items: HouseholdMembershipListItemData[] }>(
      `/households/${encodeURIComponent(householdId)}/memberships`,
      { authenticated: true },
    );
    return result.items;
  }

  public leaveHousehold(householdId: string): Promise<HouseholdMembershipData> {
    return this.request(`/households/${encodeURIComponent(householdId)}/leave`, {
      method: "POST",
      authenticated: true,
    });
  }

  public closeHousehold(householdId: string): Promise<void> {
    return this.request(`/households/${encodeURIComponent(householdId)}`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  public createInvitation(input: {
    householdId: string;
    inviteeEmail: string;
    targetProfileRef: string;
  }): Promise<FamilyInvitationCreatedData> {
    return this.request("/family-invitations", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({
        household_id: input.householdId,
        invitee_email: input.inviteeEmail,
        target_profile_ref: input.targetProfileRef,
      }),
    });
  }

  public listInvitations(): Promise<FamilyInvitationListData> {
    return this.request("/family-invitations", { authenticated: true });
  }

  public acceptInvitation(invitationId: string, token: string): Promise<FamilyInvitationData> {
    return this.transitionInvitation(invitationId, "accept", token);
  }

  public declineInvitation(invitationId: string, token: string): Promise<FamilyInvitationData> {
    return this.transitionInvitation(invitationId, "decline", token);
  }

  public cancelInvitation(invitationId: string): Promise<FamilyInvitationData> {
    return this.request(`/family-invitations/${encodeURIComponent(invitationId)}/cancel`, {
      method: "POST",
      authenticated: true,
    });
  }

  public createProfileLink(invitationId: string, localProfileRef: string): Promise<ProfileLinkData> {
    return this.request("/profile-links", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({ invitation_id: invitationId, local_profile_ref: localProfileRef }),
    });
  }

  public async listProfileLinks(): Promise<ProfileLinkData[]> {
    const result = await this.request<{ items: ProfileLinkData[] }>("/profile-links", {
      authenticated: true,
    });
    return result.items;
  }

  public unlinkProfileLink(linkId: string): Promise<ProfileLinkData> {
    return this.request(`/profile-links/${encodeURIComponent(linkId)}/unlink`, {
      method: "POST",
      authenticated: true,
    });
  }

  public clearAccessToken(): void {
    this.accessToken = undefined;
  }

  private transitionInvitation(
    invitationId: string,
    action: "accept" | "decline",
    token: string,
  ): Promise<FamilyInvitationData> {
    return this.request(`/family-invitations/${encodeURIComponent(invitationId)}/${action}`, {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({ token }),
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { authenticated = false, retryAfterRefresh = true, ...requestInit } = options;
    if (authenticated && !this.accessToken) {
      await this.refresh();
    }

    const headers = new Headers(requestInit.headers);
    headers.set("Accept", "application/json");
    if (requestInit.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated && this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers,
      credentials: "include",
    });

    if (response.status === 401 && authenticated && retryAfterRefresh) {
      this.accessToken = undefined;
      await this.refresh();
      return this.request<T>(path, { ...options, retryAfterRefresh: false });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data;
  }
}

async function toApiError(response: Response): Promise<ServerApiError> {
  try {
    const body = (await response.json()) as ApiErrorEnvelope;
    return new ServerApiError(response.status, body.error_code, body.message, body.details);
  } catch {
    return new ServerApiError(response.status, "INVALID_ERROR_RESPONSE", "서버 응답을 해석할 수 없습니다.");
  }
}

export const serverApiClient = new ServerApiClient();
