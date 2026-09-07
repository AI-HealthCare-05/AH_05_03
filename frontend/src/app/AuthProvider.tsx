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
      .then(() => serverApiClient.getAccount())
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
  }, []);

  const markSignedOut = useCallback(() => {
    setEmail(undefined);
    setAccountId(undefined);
    setStatus("signed-out");
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
    () => ({ status, email, accountId, signIn, signOut, markSignedOut, updateAccount }),
    [status, email, accountId, signIn, signOut, markSignedOut, updateAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
