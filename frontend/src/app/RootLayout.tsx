import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { SignInPage } from "../features/account/SignInPage";
import { useAuth } from "./authContext";

// 가족 홈이 "관리"(구성원·기록·검진표), 건강 현황이 "지금 어떤가"(챌린지·수치) 다.
// **2026-09-03 에 뒤집었다.** 예전에는 판정·챌린지·데이터 관리를 메뉴에서 뺐다 —
// 화면 안에서 이어지니 메뉴에 또 세우면 같은 곳으로 가는 문이 둘이 된다는 이유였다.
//
// 실제로 써 보니 반대였다. 그 화면들에 들어가려면 **어느 카드의 어느 버튼을 눌러야
// 하는지 알고 있어야** 했고, 처음 온 사람은 홈에서 더 나아가지 못했다. 문이 둘인
// 것보다 문을 못 찾는 쪽이 비싸다. 현재 위치는 `NavLink` 의 active 표시가 말한다.
// 예측 데모는 FastAPI 가 직접 내는 화면이라 SPA 라우트가 아니다. `NavLink` 로 걸면
// react-router 가 클라이언트 라우팅을 시도해 404 로 떨어진다 — 일반 앵커여야 한다.
const DEMO_PAGES = [
  { href: "/api/demo", label: "예측 데모", hint: "ML 모델과 규칙 엔진을 한 화면에서 비교합니다" },
] as const;

const NAVIGATION = [
  { to: "/", label: "가족 홈", end: true },
  { to: "/assessment", label: "위험 판정", end: false },
  { to: "/challenge", label: "챌린지", end: false },
  { to: "/insights", label: "건강 현황", end: false },
  { to: "/health-data", label: "건강 데이터", end: false },
  { to: "/data", label: "데이터 관리", end: false },
  { to: "/account", label: "계정", end: false },
] as const;

export function RootLayout() {
  const { status, email, signOut } = useAuth();

  // 갱신 토큰으로 세션을 되살리는 동안 아무것도 그리지 않는다. 로그인 화면을 먼저
  // 띄우면 **이미 로그인한 사용자에게 로그인 화면이 한 번 깜빡인다.**
  if (status === "checking") {
    return <div className="route-loading">불러오는 중…</div>;
  }

  // 리다이렉트가 아니라 `Outlet` 자리를 대신 채운다. 주소가 그대로 남아서 로그인하면
  // 원래 가려던 화면이 그대로 뜬다 — 돌아갈 곳을 따로 기억할 필요가 없다.
  if (status === "signed-out") {
    return <SignInPage />;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">이</span>
            <span className="brand-copy">
              <strong>이어봄</strong>
              <small>우리 가족 건강기록</small>
            </span>
          </NavLink>

          {/* 예전에는 좁은 화면에서 햄버거 버튼 뒤로 접혀 있었다. 항목이 셋뿐이라
              접을 이유가 없고, 한 번 더 눌러야 보이는 메뉴는 그만큼 덜 눌린다.
              언제나 탭으로 펼쳐 두고 좁은 화면에서는 헤더 아래 줄로 내린다. */}
          <nav id="primary-navigation" className="primary-navigation" aria-label="주 메뉴">
            {NAVIGATION.map((item) => (
              <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
            {DEMO_PAGES.map((item) => (
              <a key={item.href} className="navigation-external" href={item.href} title={item.hint}>
                {item.label}
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </nav>

          {/* 예전에는 여기가 `/account` 로 가는 "내 계정" 링크였는데, 주 메뉴에 이미
              "계정" 이 있어서 같은 곳으로 가는 문이 둘이었다. 헤더에서 실제로 필요한
              것은 **지금 누구로 들어와 있는가** 와 나가는 문이다. */}
          <div className="header-status">
            <span title="현재 버전은 공용 브라우저의 사용자별 보관함 잠금을 지원하지 않습니다."><i aria-hidden="true" /> 기기 로컬</span>
            {email ? <span className="header-account" title={email}>{email}</span> : null}
            <button type="button" className="header-signout" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* 라우트가 lazy 라 청크를 받는 동안 잠깐 빈다. 폴백을 안 두면 React 가
            "A component suspended while responding to synchronous input" 으로 던진다. */}
        <Suspense fallback={<div className="route-loading">불러오는 중…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="site-footer">
        <div>
          <strong>이어봄</strong>
          <span>건강정보는 내 기기에, 연결정보만 서버에</span>
        </div>
        <NavLink to="/dev/architecture">개발용 데이터 경계 확인</NavLink>
      </footer>
    </div>
  );
}
