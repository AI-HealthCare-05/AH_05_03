/**
 * 로그인 관문 화면 — 로그인 전에는 이것 하나만 보인다.
 *
 * 내비게이션을 함께 숨기는 이유
 * -----------------------------
 * 메뉴를 남겨 두면 사용자가 눌러 보고 매번 같은 화면으로 돌아온다. 아무것도 못 하는
 * 문을 여섯 개 세워 두는 셈이라, 서비스가 고장난 것처럼 읽힌다.
 *
 * 주소는 건드리지 않는다
 * ----------------------
 * 이 화면은 리다이렉트가 아니라 **레이아웃이 `Outlet` 대신 그리는 것**이다. 그래서
 * `/assessment` 로 들어온 사람은 주소가 그대로 남고, 로그인하는 순간 원래 가려던
 * 화면이 뜬다. 돌아갈 곳을 따로 기억할 필요가 없다.
 *
 * 가입과 로그인을 왜 라우트로 안 가르나
 * ------------------------------------
 * 로그인 전에는 **어느 주소로 들어와도 이 화면**이다(관문이 `Outlet` 을 대신한다).
 * `/signup` 을 라우트로 만들면 가입 직후 그 주소에 그대로 서 있게 되고, 원래 가려던
 * 화면으로 돌려보내려면 없어도 될 복귀 로직이 생긴다. 그래서 화면 안에서 가른다 —
 * 사용자에게는 두 페이지로 보이고, 주소는 원래 목적지를 그대로 들고 있다.
 */

import { type FormEvent, useState } from "react";

import { useAuth } from "../../app/authContext";
import { AuthCard } from "./AuthCard";

/** 초대 링크로 들어왔다면 그 이메일로만 수락할 수 있다. 관문에서 미리 채워 준다. */
function invitationEmail(): string | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  if (!params.get("invitation") || !params.get("token")) return undefined;
  return params.get("email") ?? undefined;
}

export function SignInPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [invited] = useState(invitationEmail);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorking(true);
    setError(undefined);
    try {
      await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""), {
        signUpFirst: mode === "signup",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  const signup = mode === "signup";

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

        <h1>{signup ? "이어봄 시작하기" : "로그인하고 시작하세요"}</h1>
        <p className="signin-lead">
          {signup
            ? "이메일과 비밀번호만 있으면 됩니다. 건강정보는 계정이 아니라 이 브라우저에 암호화해 보관합니다."
            : "위험 판정과 검진표 인식은 서비스 계정이 있어야 씁니다. 건강정보 자체는 계정이 아니라 이 브라우저에 암호화해 보관합니다."}
        </p>

        {error ? (
          <p className="alert error-alert" role="alert">
            {error}
          </p>
        ) : null}

        <AuthCard
          mode={mode}
          working={working}
          invitationEmail={invited}
          onSubmit={submit}
          onSwitchMode={() => {
            // 화면을 갈아 끼우는 것이므로 앞 화면의 실패 메시지를 들고 가지 않는다.
            setError(undefined);
            setMode(signup ? "signin" : "signup");
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
