import type {
  AccessTokenData,
  AccountCloseData,
  AccountSummary,
  ApiEnvelope,
  ApiErrorEnvelope,
  ChatMessageData,
  ChatMessageListData,
  ChatSessionData,
  ChatSessionListData,
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
   * 질환별 통합 판정. 화면이 붙는 단일 진입점이다 (`docs/adr/0009` §8).
   *
   * **본문에 건강 수치가 실린다.** 서버는 메모리에서 채점하고 응답 뒤 버리지만
   * (`NFR-01`), 전송 자체는 일어나므로 인증이 붙어 있다. `authenticated: true` 를
   * 빼면 401 이고, 그게 맞는 동작이다.
   *
   * 응답 타입을 `contracts.ts` 가 아니라 기능 폴더에서 받는 이유는 이 응답이
   * 계정 도메인이 아니라 판정 도메인에 속하기 때문이다.
   */
  public assessSummary<T>(body: Record<string, unknown>): Promise<T> {
    return this.request<T>("/assessments/summary", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify(body),
    });
  }

  /**
   * 건강 비서 대화. **인증이 붙는다.**
   *
   * PR #27 의 클라이언트는 맨 `fetch` 로 불렀는데 project 의 이 경로는 401 을 낸다 —
   * 대화 본문에 증상과 수치가 실리므로 그게 맞는 동작이다. 토큰 갱신도 여기로 모은다.
   */
  public healthAssistantChat<T>(body: Record<string, unknown>): Promise<T> {
    return this.request<T>("/health-assistant/chat", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify(body),
    });
  }

  /**
   * 챌린지. 요청·응답 어디에도 측정값이 실리지 않는다 — 서버는 "쟀다" 와 날짜만 안다.
   * 응답 타입을 기능 폴더(`features/challenge/contracts.ts`)에서 받는 이유는
   * `assessSummary` 와 같다: 계정 도메인이 아니다.
   */
  /**
   * 개발용 문서 인식 브리지 (PR #24).
   *
   * 전용 fetch 를 따로 두지 않고 이 클라이언트를 태운다 — 인증 헤더·토큰 갱신·오류
   * 봉투 처리를 공짜로 얻고, 무엇보다 **상대 경로**를 쓰게 된다. 절대 주소를 박으면
   * nginx 를 건너뛰고 교차 출처가 되며, `:8000` 은 루프백에만 묶여 있어 배포에서 죽는다.
   */
  public enqueueDocumentJob<T>(file: Blob, fileName: string): Promise<T> {
    const body = new FormData();
    body.append("file", file, fileName);
    return this.request<T>("/dev/ocr/jobs", { method: "POST", authenticated: true, body });
  }

  public readDocumentJob<T>(jobId: string): Promise<T> {
    return this.request<T>(`/dev/ocr/jobs/${encodeURIComponent(jobId)}`, { authenticated: true });
  }

  /**
   * 문서 인식 진행 상황 (SSE).
   *
   * **`EventSource` 를 쓰지 않는다.** 그쪽은 헤더를 못 붙여서 `Authorization` 을
   * 실을 수 없고, 대안인 "토큰을 쿼리스트링에" 는 nginx 액세스 로그와 브라우저
   * 히스토리에 토큰을 남긴다. `fetch` 로 읽으면 기존 인증·토큰 갱신이 그대로 걸린다.
   *
   * `signal` 로 중단할 수 있다 — 사용자가 화면을 떠나면 연결을 끊어야 서버의
   * 중계 루프도 `is_disconnected()` 로 풀려난다.
   */
  public async streamDocumentJob(
    jobId: string,
    onEvent: (event: string, data: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.send(`/dev/ocr/jobs/${encodeURIComponent(jobId)}/stream`, {
      authenticated: true,
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.body) {
      throw new ServerApiError(response.status, "STREAM_UNSUPPORTED", "이 브라우저는 스트리밍을 지원하지 않습니다.");
    }
    await readServerSentEvents(response.body, onEvent);
  }

  /**
   * 건강 비서 대화를 SSE 로 받는다. `delta` 로 글자가 흐르고 `result` 로 완성본이 온다.
   *
   * `EventSource` 를 안 쓰는 이유는 문서 인식 쪽과 같다 — 헤더를 못 붙여서
   * `Authorization` 을 쿼리스트링에 실어야 하고, 그러면 토큰이 nginx 액세스 로그와
   * 브라우저 히스토리에 남는다.
   */
  public async streamHealthAssistantChat(
    body: Record<string, unknown>,
    onEvent: (event: string, data: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.send("/health-assistant/chat/stream", {
      method: "POST",
      authenticated: true,
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.body) {
      throw new ServerApiError(response.status, "STREAM_UNSUPPORTED", "이 브라우저는 스트리밍을 지원하지 않습니다.");
    }
    await readServerSentEvents(response.body, onEvent);
  }

  public createChatSession(profileId: string, title?: string): Promise<ChatSessionData> {
    return this.request<ChatSessionData>("/chat-sessions", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify({ profile_id: profileId, title }),
    });
  }

  public async listChatSessions(profileId?: string): Promise<ChatSessionData[]> {
    const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : "";
    const res = await this.request<ChatSessionListData>(`/chat-sessions${query}`, {
      authenticated: true,
    });
    return res.items;
  }

  public getChatSession(sessionId: string): Promise<ChatSessionData> {
    return this.request<ChatSessionData>(`/chat-sessions/${encodeURIComponent(sessionId)}`, {
      authenticated: true,
    });
  }

  public async deleteChatSession(sessionId: string): Promise<void> {
    await this.request(`/chat-sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      authenticated: true,
    });
  }

  public async listChatMessages(sessionId: string): Promise<ChatMessageData[]> {
    const res = await this.request<ChatMessageListData>(
      `/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
      { authenticated: true },
    );
    return res.items;
  }

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

  /**
   * 인증·토큰 갱신·오류 봉투를 붙여 요청을 보내고 **응답을 그대로** 돌려준다.
   *
   * `request` 가 여기 위에 얹혀 JSON 을 벗기고, SSE 경로는 본문 스트림이 필요하므로
   * 이 함수를 직접 쓴다. 두 벌로 두면 한쪽만 토큰 갱신을 놓치는 사고가 난다 —
   * 증상이 "가끔 로그인 풀림" 이라 재현이 어렵다.
   */
  private async send(path: string, options: RequestOptions = {}): Promise<Response> {
    const { authenticated = false, retryAfterRefresh = true, ...requestInit } = options;
    if (authenticated && !this.accessToken) {
      await this.refresh();
    }

    const headers = new Headers(requestInit.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    // **문자열 본문일 때만** JSON 으로 선언한다. `FormData` 에 이 헤더를 씌우면
    // 브라우저가 붙이는 multipart boundary 가 사라져서 서버가 본문을 못 읽는다
    // ("Missing boundary in multipart"). 파일 업로드 경로가 생기면서 드러났다.
    if (typeof requestInit.body === "string") {
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
      return this.send(path, { ...options, retryAfterRefresh: false });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }
    return response;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);

    if (response.status === 204) {
      return undefined as T;
    }

    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data;
  }
}

/**
 * SSE 본문을 프레임 단위로 읽는다.
 *
 * **직접 파싱하는 이유.** `EventSource` 를 못 쓰니 프레임을 손으로 가른다. 규칙은
 * 단순하다 — 빈 줄이 프레임 경계이고, 한 프레임 안에서 `event:` 는 이름, `data:` 는
 * 본문이다. `:` 로 시작하는 줄은 주석(keepalive)이라 버린다.
 *
 * 청크 경계는 줄 한가운데에도 떨어진다. 그래서 **마지막 조각은 남겨 두고** 다음
 * 청크와 이어 붙인다. 이걸 빼먹으면 긴 인식 결과에서만 가끔 글자가 사라진다.
 */
async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // `stream: true` 가 있어야 여러 바이트 문자가 청크 경계에 걸려도 안 깨진다.
    // 한글은 UTF-8 에서 3바이트라 이게 없으면 흔하게 깨진다.
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      dispatchFrame(buffer.slice(0, boundary), onEvent);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function dispatchFrame(
  frame: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): void {
  let name = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // keepalive 주석
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  try {
    onEvent(name, JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
  } catch {
    // 깨진 프레임 하나 때문에 스트림 전체를 버리지 않는다.
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
