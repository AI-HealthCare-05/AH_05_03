/**
 * 로그인 관문 상태 — 서비스 계정이 있어야 예측·판정·문서 인식을 쓸 수 있다.
 *
 * 왜 화면에도 관문이 필요한가
 * ---------------------------
 * 서버는 이미 막고 있다. `/assessments`·`/predictions`·`/dev/ocr` 전부
 * `require_active_account` 가 걸려 있어 토큰 없이는 401 이다. 그런데 **화면이 그걸
 * 모르면** 사용자는 36칸을 다 채우고 판정하기를 누른 다음에야 거절당한다. 관문은
 * 서버 보안을 대신하는 게 아니라 그 사실을 미리 말해 주는 장치다.
 *
 * 왜 계정 정보 전체를 여기 두지 않는가
 * ------------------------------------
 * 구독·가정·초대·연결은 계정 화면만 쓰고 화면마다 신선도 요구가 다르다. 여기 모아
 * 두면 홈을 열 때마다 초대 목록까지 받아 온다. 이 컨텍스트는 **들어갈 수 있는가**
 * 하나만 안다.
 */

import { createContext, useContext } from "react";

export type AuthStatus = "checking" | "signed-out" | "signed-in";

export interface AuthContextValue {
  status: AuthStatus;
  /** 로그인한 계정의 이메일. 헤더가 누구로 들어와 있는지 보여 준다. */
  email?: string;
  /** 로그인한 계정의 UUID */
  accountId?: string;
  signIn(email: string, password: string, options?: { signUpFirst?: boolean }): Promise<void>;
  signOut(): Promise<void>;
  /**
   * 계정 화면이 스스로 로그아웃·회원 탈퇴를 했을 때 관문에 알린다.
   *
   * `message` 를 주면 로그인 화면에 그대로 뜬다. **여기서 관문으로 넘어가는 순간
   * 계정 화면은 통째로 사라진다** — `AccountPage` 자신이 그 직후에 띄우려던
   * 성공 메시지(건강정보 보존·폐기 결과 등)는 화면이 스스로를 unmount 하기 전에
   * 지나가 버려 아무도 못 본다. 버튼을 눌러도 아무 반응이 없는 것처럼 보이던
   * 실제 원인이다 — 요청은 성공했지만 알림이 뜰 자리가 없어졌다.
   */
  markSignedOut(message?: string): void;
  /** `markSignedOut(message)` 로 넘어온, 로그인 화면이 한 번 보여 줄 안내문. */
  signedOutNotice?: string;
  /** 계정 화면 등에서 최신 계정 정보를 동기화할 때 사용한다. */
  updateAccount?(email: string, accountId?: string): void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth는 AuthProvider 안에서 사용해야 합니다.");
  return value;
}
