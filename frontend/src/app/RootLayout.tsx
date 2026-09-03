import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useUiStore } from "../stores/uiStore";

const NAVIGATION = [
  { to: "/", label: "가족 홈", end: true },
  { to: "/assessment", label: "위험 판정", end: false },
  { to: "/challenge", label: "챌린지", end: false },
  { to: "/health-data", label: "건강 데이터", end: false },
  { to: "/data", label: "데이터 관리", end: false },
  { to: "/ui-preview", label: "UI 미리보기", end: false },
  { to: "/account", label: "계정", end: false },
] as const;

// 예측 데모는 FastAPI 가 직접 내는 화면이라 SPA 라우트가 아니다. NavLink 로 걸면
// react-router 가 클라이언트 라우팅을 시도하고 404 로 떨어진다 — 일반 앵커여야 한다.
// 규칙 엔진 화면(`/api/demo/rules`)은 데모 안에서 스위치로 바꿀 수 있으므로
// 내비게이션에는 입구를 하나만 둔다. 주소는 문서에 남아 있어 그대로 살아 있다.
const DEMO_PAGES = [
  { href: "/api/demo", label: "예측 데모", hint: "ML 모델과 규칙 엔진을 한 화면에서 비교합니다" },
] as const;

export function RootLayout() {
  const navigationOpen = useUiStore((state) => state.navigationOpen);
  const toggleNavigation = useUiStore((state) => state.toggleNavigation);
  const closeNavigation = useUiStore((state) => state.closeNavigation);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" onClick={closeNavigation}>
            <span className="brand-mark" aria-hidden="true">이</span>
            <span className="brand-copy">
              <strong>이어봄</strong>
              <small>우리 가족 건강기록</small>
            </span>
          </NavLink>

          <button
            className="menu-button"
            type="button"
            aria-expanded={navigationOpen}
            aria-controls="primary-navigation"
            onClick={toggleNavigation}
          >
            메뉴
          </button>

          <nav
            id="primary-navigation"
            className={navigationOpen ? "primary-navigation is-open" : "primary-navigation"}
            aria-label="주 메뉴"
          >
            {NAVIGATION.map((item) => (
              <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.end} onClick={closeNavigation}>
                {item.label}
              </NavLink>
            ))}
            {DEMO_PAGES.map((item) => (
              <a
                key={item.href}
                className="navigation-external"
                href={item.href}
                title={item.hint}
                onClick={closeNavigation}
              >
                {item.label}
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </nav>

          <div className="header-status">
            <span title="현재 버전은 공용 브라우저의 사용자별 보관함 잠금을 지원하지 않습니다."><i aria-hidden="true" /> 기기 로컬</span>
            <NavLink to="/account">내 계정</NavLink>
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
