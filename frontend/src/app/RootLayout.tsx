import { Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { SignInPage } from "../features/account/SignInPage";
import { serverApiClient } from "../shared/api/serverApiClient";
import { useAuth } from "./authContext";
import { LocalDomainContext } from "./localDomainContext";
import { useRouteTitle } from "./useRouteTitle";

// 가족 홈이 "관리"(구성원·기록·검진표), 건강 데이터가 "지금 어떤가"(수치 추이) 다.
// **2026-09-03 에 뒤집었다.** 예전에는 판정·챌린지·데이터 관리를 메뉴에서 뺐다 —
// 화면 안에서 이어지니 메뉴에 또 세우면 같은 곳으로 가는 문이 둘이 된다는 이유였다.
//
// 실제로 써 보니 반대였다. 그 화면들에 들어가려면 **어느 카드의 어느 버튼을 눌러야
// 하는지 알고 있어야** 했고, 처음 온 사람은 홈에서 더 나아가지 못했다. 문이 둘인
// 것보다 문을 못 찾는 쪽이 비싸다. 현재 위치는 `NavLink` 의 active 표시가 말한다.
// **"예측 데모" 가 여기 있었다.** FastAPI 가 직접 내던 단일 HTML(`/api/demo`)이라
// SPA 라우트가 아니었고 일반 앵커로 걸어 뒀다. 그 화면을 `/assessment` 로 합치면서
// 라우터와 함께 지웠다 — 폼을 한 번에 채우는 테스트 프로필과, 게이지·정확도·모델이
// 안 쓴 입력을 보여주는 "예측 근거 자세히 보기" 가 그쪽으로 옮겨 갔다.
// 화면이 둘이면 판단도 둘이 되고, 그 판단이 서버에 없다는 것이 ADR-009 가 메우려던
// 구멍이었다. 메뉴는 앱 안 라우트만 담는다 — `RootLayout.test.tsx` 가 지킨다.
//
// **"건강 현황"(`/insights`)이 여기 있었다.** 판정 스냅샷 추이를 보여 주는 화면이
// `/health-data`(기기 안 `healthRecords` 추이)와 나란히 있어서, 검사 수치를 보려면
// 어느 화면에 있는지 먼저 알아야 했다. 2026-09-10 에 `/health-data` 로 합쳤다 —
// 주소는 리다이렉트로 살아 있다(`router.tsx`).

const NAVIGATION = [
  { to: "/", label: "가족 홈", end: true },
  { to: "/pain-diary", label: "통증 다이어리", end: false },
  { to: "/assessment", label: "위험 판정", end: false },
  { to: "/challenge", label: "챌린지", end: false },
  { to: "/health-data", label: "건강 데이터", end: false },
  { to: "/account", label: "계정", end: false },
] as const;

function readResetToken(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  return Boolean(params.get("reset_token"));
}

export function RootLayout() {
  const { status, email, signOut } = useAuth();
  const navigationRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // 라우트마다 탭 제목을 맞춘다. 제목의 원천은 아래 내비 표의 라벨이다 —
  // 사용자가 아는 화면 이름이 이미 거기 있어서 따로 적어 둘 필요가 없다.
  // 훅이라 이른 반환보다 위에 있어야 한다(로그인 관문에서도 돈다).
  useRouteTitle(NAVIGATION);

  // 좁은 화면에서 메뉴는 가로로 미는 레일이다(`styles.css` 760px 블록). 링크를
  // 눌러 들어왔다면 누른 항목이 이미 보이지만, **새로고침하거나 주소로 바로
  // 들어오면 레일이 왼쪽 끝에서 시작한다** — 일곱 번째 "계정" 에 서 있어도 화면에는
  // 첫 항목만 보이고, 현재 위치 표시가 화면 밖에 있다. 표시를 고쳐 놓고 안 보이면
  // 고친 의미가 없어서 여기서 끌어온다.
  //
  // 넓은 화면에서는 레일이 넘치지 않아(`flex-wrap: wrap`) 아무 일도 일어나지 않는다.
  // 훅이라 이른 반환보다 위에 있어야 한다 — 로그인 전에는 `nav` 자체가 없고,
  // 그때는 찾는 것이 없어 그대로 빠져나간다.
  useEffect(() => {
    const active = navigationRef.current?.querySelector<HTMLElement>("a.active");
    if (!active) return;
    active.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      // 세로는 건드리지 않는다. 헤더가 sticky 라 이미 보이는데 `start` 를 주면
      // 본문이 함께 밀린다.
      block: "nearest",
      inline: "nearest",
    });
  }, [pathname]);
  const localDomain = useContext(LocalDomainContext);
  const profiles = useMemo(() => localDomain?.profiles ?? [], [localDomain?.profiles]);
  const [matchedProfileName, setMatchedProfileName] = useState<string>();
  const [hasResetToken, setHasResetToken] = useState(readResetToken);

  useEffect(() => {
    const handleHashChange = () => {
      setHasResetToken(readResetToken());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (status !== "signed-in") {
      setMatchedProfileName(undefined);
      return;
    }
    let cancelled = false;
    void serverApiClient
      .listProfileLinks()
      .then((links) => {
        if (cancelled) return;
        const activeLink = links.find((l) => l.status === "active");
        if (activeLink) {
          const profile = profiles.find((p) => p.opaqueServerRef === activeLink.local_profile_ref);
          if (profile) {
            setMatchedProfileName(profile.displayName);
            return;
          }
        }
        setMatchedProfileName(undefined);
      })
      .catch(() => {
        if (!cancelled) setMatchedProfileName(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [status, email, profiles]);

  // 갱신 토큰으로 세션을 되살리는 동안 아무것도 그리지 않는다. 로그인 화면을 먼저
  // 띄우면 **이미 로그인한 사용자에게 로그인 화면이 한 번 깜빡인다.**
  if (status === "checking") {
    return <div className="route-loading">불러오는 중…</div>;
  }

  // 리다이렉트가 아니라 `Outlet` 자리를 대신 채운다. 주소가 그대로 남아서 로그인하면
  // 원래 가려던 화면이 그대로 뜬다 — 돌아갈 곳을 따로 기억할 필요가 없다.
  // 단, 비밀번호 재설정 링크(#reset_token=...)로 진입한 경우에는 로그인 상태와 무관하게
  // 재설정 관문을 우선 열어 준다.
  if (hasResetToken || status === "signed-out") {
    return <SignInPage onResetComplete={() => setHasResetToken(false)} />;
  }

  return (
    <div className="app-shell">
      {/* **본문 건너뛰기.** 헤더에 브랜드 + 주 메뉴 7개 + 계정 + 로그아웃이 있어서,
          키보드나 낭독기로 들어온 사람은 화면마다 그 열 개를 다시 지나야 본문에
          닿는다. 첫 탭에서 건너뛸 자리를 준다 — 평소에는 화면 밖에 있고 포커스를
          받을 때만 나타난다(`.skip-to-main` 참조). */}
      <a className="skip-to-main" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/">
            <img className="brand-mark" src="/ieobom-icon.svg" alt="" aria-hidden="true" width={42} height={42} />
            <span className="brand-copy">
              <strong>이어봄</strong>
              <small>우리 가족 건강기록</small>
            </span>
          </NavLink>

          {/* 예전에는 좁은 화면에서 햄버거 버튼 뒤로 접혀 있었다. 항목이 셋뿐이라
              접을 이유가 없고, 한 번 더 눌러야 보이는 메뉴는 그만큼 덜 눌린다.
              언제나 탭으로 펼쳐 두고 좁은 화면에서는 헤더 아래 줄로 내린다. */}
          <nav
            id="primary-navigation"
            className="primary-navigation"
            aria-label="주 메뉴"
            ref={navigationRef}
          >
            {NAVIGATION.map((item) => (
              <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* 예전에는 여기가 `/account` 로 가는 "내 계정" 링크였는데, 주 메뉴에 이미
              "계정" 이 있어서 같은 곳으로 가는 문이 둘이었다. 헤더에서 실제로 필요한
              것은 **지금 누구로 들어와 있는가** 와 나가는 문이다. */}
          <div className="header-status">
            {/* **"기기 로컬" 이었다.** ADR-011 로 건강기록 정본이 PostgreSQL 로 옮겨
                갔는데(2026-09-04) 이 배지만 남아서, 서버에서 읽어 온 숫자를 보여주는
                화면이 헤더에서는 "기기 로컬" 이라고 말하고 있었다. 배지가 답해야 하는
                것은 **지금 이 기록이 어디에 있는가** 다. */}
            <span title="건강기록은 로그인한 계정에 저장되고, 기기를 바꿔도 같은 기록을 봅니다.">
              <i aria-hidden="true" /> 계정 동기화
            </span>
            {email ? (
              <span className="header-account" title={email}>
                {matchedProfileName ? `${matchedProfileName} (${email})` : email}
              </span>
            ) : null}
            <button type="button" className="header-signout" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {/* 라우트가 lazy 라 청크를 받는 동안 잠깐 빈다. 폴백을 안 두면 React 가
            "A component suspended while responding to synchronous input" 으로 던진다. */}
        <Suspense fallback={<div className="route-loading">불러오는 중…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="site-footer">
        <div>
          <strong>이어봄</strong>
          {/* 같은 이유로 고쳤다 — 위 배지 주석 참조. 이 줄이 모든 화면 아래에 있어서
              틀린 약속이 가장 넓게 퍼지던 자리다. */}
          <span>건강기록은 내 계정에, 나와 가족만 열람</span>
        </div>
        {/* **개발용 화면은 개발 빌드에만 낸다.** 게이트가 없어서 배포본 푸터에 그대로
            나가고 있었다(7개 라우트 중 6개에서 확인). `import.meta.env.DEV` 는 Vite 가
            `vite build` 에서 `false` 로 정적 치환하므로 운영 번들에서는 이 분기와 링크가
            함께 사라진다 — 숨기는 것이 아니라 빠진다. */}
        {import.meta.env.DEV ? <NavLink to="/dev/architecture">개발용 데이터 경계 확인</NavLink> : null}
      </footer>
    </div>
  );
}
