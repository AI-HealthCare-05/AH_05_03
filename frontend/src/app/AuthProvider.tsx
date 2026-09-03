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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [email, setEmail] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void serverApiClient
      .refresh()
      .then(() => serverApiClient.getAccount())
      .then((account) => {
        if (!cancelled) {
          setEmail(account.account.email);
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

  const signIn = useCallback(async (address: string, password: string, options?: { signUpFirst?: boolean }) => {
    if (options?.signUpFirst) await serverApiClient.signUp(address, password);
    await serverApiClient.login(address, password);
    const account = await serverApiClient.getAccount();
    setEmail(account.account.email);
    setStatus("signed-in");
  }, []);

  const markSignedOut = useCallback(() => {
    setEmail(undefined);
    setStatus("signed-out");
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
    () => ({ status, email, signIn, signOut, markSignedOut }),
    [status, email, signIn, signOut, markSignedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
