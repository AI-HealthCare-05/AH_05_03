/**
 * 로그인 관문 화면 — 로그인 전에는 이것 하나만 보인다.
 */

import { type FormEvent, useState } from "react";

import { useAuth } from "../../app/authContext";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { AuthCard, type AuthMode } from "./AuthCard";
import { getPendingInvitation, readAndPreserveInvitation } from "./invitationStorage";

/** 초대 링크로 들어왔다면 그 이메일로만 수락할 수 있다. 관문에서 미리 채워 준다. */
function invitationEmail(): string | undefined {
  return readAndPreserveInvitation()?.email;
}

/** 비밀번호 재설정 링크로 들어왔다면 토큰을 읽는다. */
function readResetToken(): { token: string; email?: string } | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const token = params.get("reset_token");
  if (!token) return undefined;
  return { token, email: params.get("email") ?? undefined };
}

export function SignInPage({
  onResetComplete,
  initialMessage,
}: {
  onResetComplete?: () => void;
  /** 로그아웃·회원 탈퇴 직후 관문으로 넘어오며 실어 온 한 번짜리 안내문. */
  initialMessage?: string;
} = {}) {
  const { signIn } = useAuth();
  const [resetInfo, setResetInfo] = useState(readResetToken);
  const [resetEmail] = useState(() => readResetToken()?.email);
  const [mode, setMode] = useState<AuthMode>(() => (resetInfo ? "reset-password" : "signin"));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string | undefined>(initialMessage);
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
        // URL hash 정리: 대기 중인 초대가 있다면 해당 해시를 복원하여 로그인 후에도 토큰이 전달되도록 한다
        const pending = getPendingInvitation();
        if (pending) {
          const nextHash = new URLSearchParams({
            invitation: pending.invitationId,
            token: pending.token,
            ...(pending.email ? { email: pending.email } : {}),
          }).toString();
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextHash}`);
        } else {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        setResetInfo(undefined);
        onResetComplete?.();
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
    // **가입 전에 하는 약속이라 가장 조심해야 하는 문구다.** 예전에는 "건강정보는
    // 계정이 아니라 이 브라우저에 암호화해 보관합니다" 였는데, ADR-011 로 정본이
    // PostgreSQL 로 옮겨간 뒤(2026-09-04) 사실이 아니다. 동의 직전 화면에서 틀린
    // 약속을 하는 것이 이 축에서 가장 무거운 결함이었다.
    signin: "질환 예측과 검진표 인식은 서비스 계정이 있어야 씁니다. 건강기록은 계정에 저장되어 기기를 바꿔도 이어집니다.",
    signup: "이메일과 비밀번호만 있으면 됩니다. 건강기록은 계정에 저장되고, 나와 가족 구성원만 열람합니다.",
    "forgot-password": "가입하신 이메일로 비밀번호 재설정 링크를 받아 새 비밀번호를 설정할 수 있습니다.",
    "reset-password": "새로 사용할 비밀번호를 입력하여 계정 보안을 복원하세요.",
  }[mode];

  return (
    <div className="signin-shell">
      <div className="signin-panel">
        <div className="signin-brand">
          <img className="brand-mark" src="/ieobom-icon.svg" alt="" aria-hidden="true" width={42} height={42} />
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
          key={`${mode}-${resetInfo?.email ?? resetEmail ?? invited ?? ""}`}
          mode={mode}
          working={working}
          invitationEmail={resetInfo?.email ?? resetEmail ?? invited}
          onSubmit={submit}
          onSwitchMode={(targetMode) => {
            setError(undefined);
            setMessage(undefined);
            setMode(targetMode);
          }}
        />

        {/* 세 줄 전부 ADR-011 이전의 약속이었다. 지금은 건강기록도 서버 정본이므로
            "서버에는 계정만" 은 틀리고, 대신 실제로 성립하는 것을 적는다 — 어디에
            저장되는지, 누가 볼 수 있는지, 원본 서류는 어떻게 되는지. */}
        <ul className="signin-notes">
          <li>건강기록·프로필·판정 결과는 로그인한 계정에 저장됩니다.</li>
          <li>검진표 원본은 보관하지 않고, 읽어 들이는 동안에만 씁니다.</li>
          <li>같은 가정 구성원 외에는 열람할 수 없습니다.</li>
        </ul>
      </div>
    </div>
  );
}
