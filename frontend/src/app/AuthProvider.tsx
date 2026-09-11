/**
 * 로그인 관문의 상태를 들고 있는 provider.
 *
 * 부팅할 때 한 번 `refresh()` 를 던진다. 접근 토큰은 메모리에만 있어서 새로고침하면
 * 사라지지만 **갱신 토큰은 httpOnly 쿠키**라 살아 있다 — 그걸로 조용히 되살린다.
 * 이 한 번이 없으면 새로고침마다 로그인 화면이 떠서, 쓰던 사람이 쫓겨난 것처럼 느낀다.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { serverApiClient } from "../shared/api/serverApiClient";
import { AuthContext, type AuthStatus } from "./authContext";
import { readAndPreserveInvitation } from "../features/account/invitationStorage";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [email, setEmail] = useState<string>();
  const [accountId, setAccountId] = useState<string>();
  const [signedOutNotice, setSignedOutNotice] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    readAndPreserveInvitation();

    // 비밀번호 재설정 링크(#reset_token=...)로 들어온 경우 기존 세션을 갱신하지 않고
    // 즉시 로그아웃시켜 새 비밀번호 설정 관문을 안전하게 열 수 있도록 한다.
    const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
    if (params.has("reset_token")) {
      void serverApiClient.logout().catch(() => {});
      setStatus("signed-out");
      return;
    }

    void serverApiClient
      .refresh()
      .then(() => {
        // **가구 목록을 계정 조회와 나란히 출발시킨다.** 둘 다 토큰만 있으면 되는데,
        // 예전에는 `refresh → account → (signed-in) → households` 로 줄을 서서 왕복
        // 셋이 직렬이었다(실측 ~950ms). 여기서 미리 보내 두면 `LocalDomainProvider`
        // 가 잠시 뒤 같은 요청을 부를 때 새로 보내지 않고 이 응답을 같이 받는다
        // (`serverApiClient` 의 in-flight GET 합치기) — 호출 수는 그대로, 대기만 준다.
        // 실패하면 합칠 약속이 사라질 뿐이라 그쪽이 알아서 다시 묻는다.
        void serverApiClient.listHouseholds().catch(() => undefined);
        return serverApiClient.getAccount();
      })
      .then((account) => {
        if (!cancelled) {
          setEmail(account.account.email);
          setAccountId(account.account.id);
          setStatus("signed-in");
        }
      })
      // 갱신 실패는 오류가 아니다 — 아직 로그인하지 않았거나 쿠키가 만료된 것뿐이다.
      .catch(() => {
        if (!cancelled) setStatus("signed-out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      readAndPreserveInvitation();
      const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
      if (params.has("reset_token")) {
        void serverApiClient.logout().catch(() => {});
        setEmail(undefined);
        setAccountId(undefined);
        setStatus("signed-out");
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const signIn = useCallback(async (address: string, password: string, options?: { signUpFirst?: boolean }) => {
    if (options?.signUpFirst) await serverApiClient.signUp(address, password);
    await serverApiClient.login(address, password);
    const account = await serverApiClient.getAccount();
    setEmail(account.account.email);
    setAccountId(account.account.id);
    setStatus("signed-in");
    // 다음 로그인은 이전 안내문과 무관한 시도다 — 지난 탈퇴·로그아웃 알림이
    // 새로 로그인한 화면에 다시 뜨면 안 된다.
    setSignedOutNotice(undefined);
  }, []);

  const markSignedOut = useCallback((message?: string) => {
    setEmail(undefined);
    setAccountId(undefined);
    setStatus("signed-out");
    setSignedOutNotice(message);
  }, []);

  const updateAccount = useCallback((newEmail: string, newAccountId?: string) => {
    setEmail(newEmail);
    if (newAccountId) setAccountId(newAccountId);
  }, []);

  const signOut = useCallback(async () => {
    // 서버 쪽 실패로 화면이 로그인 상태에 갇히면 빠져나올 길이 없다. 세션 종료 요청이
    // 실패해도 이쪽은 내려놓는다 — 남은 쿠키는 만료되고, 접근 토큰은 이미 버렸다.
    try {
      await serverApiClient.logout();
    } finally {
      serverApiClient.clearAccessToken();
      markSignedOut();
    }
  }, [markSignedOut]);

  const value = useMemo(
    () => ({ status, email, accountId, signIn, signOut, markSignedOut, signedOutNotice, updateAccount }),
    [status, email, accountId, signIn, signOut, markSignedOut, signedOutNotice, updateAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
