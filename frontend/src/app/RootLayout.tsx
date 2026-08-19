import { NavLink, Outlet } from "react-router-dom";

import { useUiStore } from "../stores/uiStore";

export function RootLayout() {
  const navigationOpen = useUiStore((state) => state.navigationOpen);
  const toggleNavigation = useUiStore((state) => state.toggleNavigation);
  const closeNavigation = useUiStore((state) => state.closeNavigation);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" onClick={closeNavigation}>
            <span className="brand-mark" aria-hidden="true">
              이
            </span>
            <span>
              <strong>이어봄</strong>
              <small>내 건강정보는 내 기기에</small>
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
            <NavLink to="/" end onClick={closeNavigation}>
              시작
            </NavLink>
            <NavLink to="/architecture" onClick={closeNavigation}>
              데이터 경계
            </NavLink>
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>현재 화면은 로컬 우선 프론트엔드 기반 검증용입니다.</p>
      </footer>
    </div>
  );
}
