/**
 * 로그인 관문 화면 — 로그인 전에는 이것 하나만 보인다.
 */

import { type FormEvent, useState } from "react";

import { useAuth } from "../../app/authContext";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { AuthCard, type AuthMode } from "./AuthCard";

/** 초대 링크로 들어왔다면 그 이메일로만 수락할 수 있다. 관문에서 미리 채워 준다. */
function invitationEmail(): string | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  if (!params.get("invitation") || !params.get("token")) return undefined;
  return params.get("email") ?? undefined;
}

/** 비밀번호 재설정 링크로 들어왔다면 토큰을 읽는다. */
function readResetToken(): { token: string; email?: string } | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const token = params.get("reset_token");
  if (!token) return undefined;
  return { token, email: params.get("email") ?? undefined };
}

export function SignInPage() {
  const { signIn } = useAuth();
  const [resetInfo, setResetInfo] = useState(readResetToken);
  const [mode, setMode] = useState<AuthMode>(() => (resetInfo ? "reset-password" : "signin"));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [invited] = useState(invitationEmail);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorking(true);
    setError(undefined);
    setMessage(undefined);

    try {
      if (mode === "signin" || mode === "signup") {
        await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""), {
          signUpFirst: mode === "signup",
        });
      } else if (mode === "forgot-password") {
        const email = String(form.get("email") ?? "");
        await serverApiClient.requestPasswordReset(email);
        setMessage("입력하신 이메일로 비밀번호 재설정 링크를 전송했습니다. 메일함을 확인해 주세요.");
      } else if (mode === "reset-password") {
        const password = String(form.get("password") ?? "");
        const confirm = String(form.get("passwordConfirm") ?? "");
        if (password !== confirm) {
          throw new Error("새 비밀번호와 비밀번호 확인이 일치하지 않습니다.");
        }
        const token = resetInfo?.token;
        if (!token) {
          throw new Error("유효한 재설정 토큰이 없습니다. 비밀번호 찾기를 다시 진행해 주세요.");
        }
        await serverApiClient.confirmPasswordReset(token, password);
        // URL hash 정리
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setResetInfo(undefined);
        setMessage("비밀번호가 성공적으로 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
        setMode("signin");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업을 완료하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  const headingText = {
    signin: "로그인하고 시작하세요",
    signup: "이어봄 시작하기",
    "forgot-password": "비밀번호 찾기",
    "reset-password": "새 비밀번호 설정",
  }[mode];

  const leadText = {
    signin: "위험 판정과 검진표 인식은 서비스 계정이 있어야 씁니다. 건강정보 자체는 계정이 아니라 이 브라우저에 암호화해 보관합니다.",
    signup: "이메일과 비밀번호만 있으면 됩니다. 건강정보는 계정이 아니라 이 브라우저에 암호화해 보관합니다.",
    "forgot-password": "가입하신 이메일로 비밀번호 재설정 링크를 받아 새 비밀번호를 설정할 수 있습니다.",
    "reset-password": "새로 사용할 비밀번호를 입력하여 계정 보안을 복원하세요.",
  }[mode];

  return (
    <div className="signin-shell">
      <div className="signin-panel">
        <div className="signin-brand">
          <span className="brand-mark" aria-hidden="true">
            이
          </span>
          <div>
            <strong>이어봄</strong>
            <small>우리 가족 건강기록</small>
          </div>
        </div>

        <h1>{headingText}</h1>
        <p className="signin-lead">{leadText}</p>

        {error ? (
          <p className="alert error-alert" role="alert">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="alert success-alert" role="status">
            {message}
          </p>
        ) : null}

        <AuthCard
          mode={mode}
          working={working}
          invitationEmail={resetInfo?.email ?? invited}
          onSubmit={submit}
          onSwitchMode={(targetMode) => {
            setError(undefined);
            setMessage(undefined);
            setMode(targetMode);
          }}
        />

        <ul className="signin-notes">
          <li>서버에는 계정·구독·가족 연결만 남습니다.</li>
          <li>건강기록·검진표·판정 결과는 이 기기의 암호화 보관함에 있습니다.</li>
          <li>로그아웃해도 이 브라우저의 건강정보는 지워지지 않습니다.</li>
        </ul>
      </div>
    </div>
  );
}
