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
 * 가입만 주소를 가진다
 * --------------------
 * 관문이 `Outlet` 을 대신하는 구조라 로그인 전에는 **어느 주소로 들어와도 이 화면**
 * 이다. 그런데 가입은 링크로 건네고 즐겨찾기할 수 있어야 해서 `/signup` 하나만
 * 진짜 라우트로 뺐다(`SignUpPage`). 대신 여기서 넘어갈 때 **원래 가려던 주소를
 * 들려 보낸다** — 안 그러면 `/assessment` 를 노리고 온 사람이 가입을 마친 뒤
 * 홈에 떨어져 처음부터 다시 찾아가야 한다.
 */

import { type FormEvent, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../../app/authContext";
import { AuthCard } from "./AuthCard";
import { invitationEmail } from "./invitation";

export function SignInPage() {
  const { signIn } = useAuth();
  const location = useLocation();
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
        signUpFirst: false,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  // 해시까지 들고 간다. 초대 링크(`#invitation=…&token=…`)로 들어온 사람이 가입으로
  // 넘어가면 그 토큰이 살아 있어야 가입 직후 초대를 수락할 수 있다.
  const from = `${location.pathname}${location.search}${location.hash}`;

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

        <h1>로그인하고 시작하세요</h1>
        <p className="signin-lead">
          위험 판정과 검진표 인식은 서비스 계정이 있어야 씁니다. 건강정보 자체는
          계정이 아니라 이 브라우저에 암호화해 보관합니다.
        </p>

        {error ? (
          <p className="alert error-alert" role="alert">
            {error}
          </p>
        ) : null}

        <AuthCard
          mode="signin"
          working={working}
          invitationEmail={invited}
          onSubmit={submit}
          footer={
            <>
              아직 계정이 없으신가요?{" "}
              <Link to="/signup" state={{ from }}>
                회원가입
              </Link>
            </>
          }
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
