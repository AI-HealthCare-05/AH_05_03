/**
 * 가입 카드와 로그인 카드. 한 번에 **하나만** 그린다.
 *
 * 왜 갈랐나 — 실제로 난 버그
 * --------------------------
 * 예전에는 한 폼 안에 `가입`(secondary)과 `로그인`(primary) 두 submit 버튼이 있었고,
 * 마크업 순서상 `가입` 이 먼저였다. **입력창에서 Enter 를 치면 브라우저는 폼의 첫
 * submit 버튼을 `submitter` 로 잡는다.** 그래서 이메일·비밀번호가 맞는 사람이
 * Enter 를 치면 로그인이 아니라 가입이 나가고, 서버는 정직하게 409 "이미 존재하는
 * 이메일입니다" 를 돌려줬다. 사용자 눈에는 맞는 비밀번호를 넣었는데 엉뚱한 말이
 * 뜨는 것으로만 보인다.
 *
 * 버튼 순서를 바꾸는 것으로는 부족하다. 그러면 이번에는 가입하려던 사람이 Enter 를
 * 쳤을 때 로그인이 나간다. **한 폼에 목적이 다른 submit 두 개를 두는 것 자체가
 * 문제다.** 그래서 화면을 갈랐다 — 폼마다 submit 이 하나뿐이니 Enter 가 무엇을
 * 하는지 물어볼 필요가 없다.
 */

import type { FormEvent } from "react";

export function AuthCard({
  mode,
  working,
  invitationEmail,
  onSubmit,
  onSwitchMode,
}: {
  mode: "signin" | "signup";
  working: boolean;
  /** 초대 링크로 들어온 경우의 이메일. 그 주소로만 수락할 수 있다. */
  invitationEmail?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSwitchMode?: () => void;
}) {
  const signup = mode === "signup";

  return (
    <section className="account-card auth-card">
      <p className="section-kicker">{invitationEmail ? "가족 초대" : "서비스 계정"}</p>
      <h2>{signup ? "서비스 계정 만들기" : "로그인"}</h2>
      <p>
        {invitationEmail
          ? `${invitationEmail} 주소로 초대받았습니다. 이 이메일로 ${signup ? "가입하세요" : "로그인하세요"}.`
          : signup
            ? "계정은 인증·구독·가족 초대만 관리합니다. 건강정보는 이 브라우저에 남습니다."
            : "가입하신 이메일로 로그인하세요."}
      </p>

      <form className="product-form" onSubmit={(event) => void onSubmit(event)}>
        <label>
          이메일
          <input name="email" type="email" autoComplete="email" defaultValue={invitationEmail} required />
        </label>
        <label>
          비밀번호
          {/* 가입과 로그인의 `autocomplete` 이 다르다. 가입 화면에 `current-password`
              를 두면 비밀번호 관리자가 새 비밀번호를 제안하지 않고 옛 것을 채운다. */}
          <input
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={8}
            aria-describedby={signup ? "auth-password-hint" : undefined}
            required
          />
        </label>
        {/* 힌트를 `<label>` 안에 두면 칸 이름이 "비밀번호8자 이상" 이 된다.
            밖에 두고 `aria-describedby` 로 잇는다. */}
        {signup ? (
          <span className="auth-hint" id="auth-password-hint">
            8자 이상
          </span>
        ) : null}

        {/* 이 폼의 submit 은 하나뿐이다. Enter 가 곧 이 버튼이다. */}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={working}>
            {working ? "처리 중…" : signup ? "가입하기" : "로그인"}
          </button>
        </div>
      </form>

      {onSwitchMode ? (
        <p className="auth-switch">
          {signup ? "이미 계정이 있으신가요?" : "아직 계정이 없으신가요?"}{" "}
          {/* `type="button"` 이 없으면 폼 밖이어도 브라우저가 submit 으로 읽는 일이 있다. */}
          <button type="button" onClick={onSwitchMode}>
            {signup ? "로그인" : "회원가입"}
          </button>
        </p>
      ) : null}
    </section>
  );
}
