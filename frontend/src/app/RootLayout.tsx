import { NavLink, Outlet } from "react-router-dom";

import { useUiStore } from "../stores/uiStore";

const NAVIGATION = [
  { to: "/", label: "대시보드", end: true },
  { to: "/health-data", label: "건강 데이터", end: false },
  { to: "/health-files", label: "건강 파일", end: false },
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
          </nav>

          <div className="header-status">
            <span title="현재 버전은 공용 브라우저의 사용자별 보관함 잠금을 지원하지 않습니다."><i aria-hidden="true" /> 기기 로컬</span>
            <NavLink to="/account">내 계정</NavLink>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
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
