/**
 * 가입, 로그인, 비밀번호 찾기, 비밀번호 재설정 카드. 한 번에 **하나만** 그린다.
 */

import { type FormEvent, useState } from "react";

export type AuthMode = "signin" | "signup" | "forgot-password" | "reset-password";

function EyeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function AuthCard({
  mode,
  working,
  invitationEmail,
  onSubmit,
  onSwitchMode,
}: {
  mode: AuthMode;
  working: boolean;
  /** 초대 링크로 들어온 경우의 이메일. 그 주소로만 수락할 수 있다. */
  invitationEmail?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSwitchMode?: (targetMode: AuthMode) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  if (mode === "forgot-password") {
    return (
      <section className="account-card auth-card">
        <p className="section-kicker">비밀번호 재설정</p>
        <h2>비밀번호 찾기</h2>
        <p>가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.</p>

        <form className="product-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            이메일
            <input name="email" type="email" autoComplete="email" defaultValue={invitationEmail} required />
          </label>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={working}>
              {working ? "발송 중…" : "재설정 링크 받기"}
            </button>
          </div>
        </form>

        {onSwitchMode ? (
          <p className="auth-switch">
            기억나셨나요?{" "}
            <button type="button" onClick={() => onSwitchMode("signin")}>
              로그인으로 돌아가기
            </button>
          </p>
        ) : null}
      </section>
    );
  }

  if (mode === "reset-password") {
    return (
      <section className="account-card auth-card">
        <p className="section-kicker">비밀번호 재설정</p>
        <h2>새 비밀번호 설정</h2>
        <p>새로 사용할 비밀번호를 8자 이상 입력하세요.</p>

        <form className="product-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            새 비밀번호
            <div className="password-input-wrapper">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                aria-describedby="auth-reset-password-hint"
                required
              />
              <button
                type="button"
                className="password-toggle-button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "새 비밀번호 숨기기" : "새 비밀번호 보기"}
                title={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
          <span className="auth-hint" id="auth-reset-password-hint">
            8자 이상
          </span>

          <label>
            새 비밀번호 확인
            <div className="password-input-wrapper">
              <input
                name="passwordConfirm"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                className="password-toggle-button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? "새 비밀번호 확인 숨기기" : "새 비밀번호 확인 보기"}
                title={showConfirmPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={working}>
              {working ? "변경 중…" : "비밀번호 변경하기"}
            </button>
          </div>
        </form>

        {onSwitchMode ? (
          <p className="auth-switch">
            <button type="button" onClick={() => onSwitchMode("signin")}>
              로그인으로 돌아가기
            </button>
          </p>
        ) : null}
      </section>
    );
  }

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
          <div className="password-input-wrapper">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={8}
              aria-describedby={signup ? "auth-password-hint" : undefined}
              required
            />
            <button
              type="button"
              className="password-toggle-button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              title={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>
        {signup ? (
          <span className="auth-hint" id="auth-password-hint">
            8자 이상
          </span>
        ) : null}

        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={working}>
            {working ? "처리 중…" : signup ? "가입하기" : "로그인"}
          </button>
        </div>
      </form>

      {onSwitchMode ? (
        <div className="auth-switch-links">
          <p className="auth-switch">
            {signup ? "이미 계정이 있으신가요?" : "아직 계정이 없으신가요?"}{" "}
            <button type="button" onClick={() => onSwitchMode(signup ? "signin" : "signup")}>
              {signup ? "로그인" : "회원가입"}
            </button>
          </p>
          {!signup ? (
            <p className="auth-switch">
              비밀번호를 잊으셨나요?{" "}
              <button type="button" onClick={() => onSwitchMode("forgot-password")}>
                비밀번호 찾기
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
