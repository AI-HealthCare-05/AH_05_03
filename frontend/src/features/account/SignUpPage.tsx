/**
 * 회원가입 화면 — 관문과 달리 **자기 주소(`/signup`)를 가진다.**
 *
 * 왜 라우트로 뺐나
 * ----------------
 * 로그인 관문은 `RootLayout` 이 `Outlet` 대신 그리는 것이라 주소가 없다. 그 방식은
 * "가려던 곳을 기억할 필요가 없다" 는 장점이 있는 대신, 가입 화면을 링크로 건네거나
 * 즐겨찾기할 수 없다. 가입은 사람에게 보내 주는 주소라서 그게 필요하다.
 *
 * 가입 뒤 어디로 가나
 * -------------------
 * 라우트로 빼면 "가입 직후 `/signup` 에 그대로 서 있는" 문제가 생긴다. 여기서는
 * 상태를 보고 스스로 비킨다 — 가입에 성공하면 `status` 가 `signed-in` 이 되고
 * 아래 `Navigate` 가 **관문에서 들려 보낸 원래 주소**로 넘긴다. 넘어온 주소가
 * 없으면(주소창에 직접 친 경우) 홈이다.
 *
 * 이미 로그인한 사람이 이 주소로 와도 같은 길로 빠진다. 로그인한 채 가입 폼을
 * 보고 있는 상태는 만들지 않는다.
 *
 * 관문 밖에 있어도 되는 이유
 * --------------------------
 * 이 화면은 기기 안 건강기록을 읽지 않는다(`useLocalDomain` 을 쓰지 않는다).
 * 관문 밖에 둘 수 있는 화면의 조건이 그것이고, `router.test.tsx` 가 그 예외를
 * 이 하나로 못 박는다.
 */

import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../app/authContext";
import { useDocumentTitle } from "../../app/useRouteTitle";
import { AuthCard } from "./AuthCard";
import { invitationEmail } from "./invitation";

export function SignUpPage() {
  // `RootLayout` 밖이고 내비에도 없는 화면이라 제목을 직접 정한다.
  useDocumentTitle("가입");
  const { status, signIn } = useAuth();
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
      // 가입과 로그인을 한 번에 한다. 갈라 두면 가입 직후 다시 로그인 화면을 보게
      // 되는데, 방금 정한 비밀번호를 그 자리에서 또 치라는 뜻이 된다.
      await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""), {
        signUpFirst: true,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가입하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  const from = (location.state as { from?: string } | null)?.from;

  // 세션을 확인하는 동안은 아무것도 그리지 않는다. 이미 로그인한 사람에게 가입
  // 폼이 한 번 깜빡이면 계정이 없어진 것처럼 보인다 (`RootLayout` 과 같은 이유).
  if (status === "checking") {
    return <div className="route-loading">불러오는 중…</div>;
  }

  if (status === "signed-in") {
    return <Navigate to={from ?? "/"} replace />;
  }

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

        <h1>이어봄 시작하기</h1>
        <p className="signin-lead">
          이메일과 비밀번호만 있으면 됩니다. 건강기록은 계정에 저장되고, 나와 가족
          구성원만 열람합니다.
        </p>

        {error ? (
          <p className="alert error-alert" role="alert">
            {error}
          </p>
        ) : null}

        <AuthCard
          mode="signup"
          working={working}
          invitationEmail={invited}
          onSubmit={submit}
          footer={
            <>
              이미 계정이 있으신가요?{" "}
              {/* 관문은 주소가 없다. 원래 가려던 곳으로 돌려보내면 거기서 관문이
                  다시 뜬다 — "로그인 화면 주소" 를 지어낼 필요가 없다. */}
              <Link to={from ?? "/"}>로그인</Link>
            </>
          }
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
