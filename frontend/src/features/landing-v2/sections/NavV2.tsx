/**
 * 떠 있는 캡슐 내비게이션.
 *
 * 디자인 시스템의 **Navigation Pill** 그대로다 — Paper White 채움, 1px Ash 테두리,
 * 100px 반경, 항목은 15px 굵기 300 의 오버진. 맨 위에서는 테두리도 채움도 없이
 * 글자만 떠 있고, 스크롤이 시작되면 캡슐이 나타나 어떤 장면 위에서도 글이 읽힌다.
 *
 * 항목을 늘리지 않는다. 앱의 주 메뉴(`RootLayout`)와 다른 물건이다 — 저쪽은 로그인한
 * 사람이 화면 사이를 오가는 문이고, 이쪽은 아직 아무것도 모르는 사람에게 세 곳만
 * 가리킨다.
 *
 * `backdrop-filter` 를 쓰지 않는다. 화면 전체를 덮는 고정 요소에 걸면 스크롤하는
 * 동안 매 프레임 뷰포트를 블러 합성한다(v1 실측).
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { subscribeScroll } from "../../landing/scrollProgress";
import { BrandMarkV2 } from "../BrandMarkV2";

const SECTIONS = [
  { href: "#v2-service", label: "서비스" },
  { href: "#v2-challenge", label: "건강 챌린지" },
  { href: "#v2-family", label: "가족 건강" },
] as const;

export function NavV2() {
  const [lifted, setLifted] = useState(false);
  const liftedRef = useRef(false);

  useEffect(() => {
    return subscribeScroll(() => {
      const next = window.scrollY > 24;
      if (next === liftedRef.current) return;
      liftedRef.current = next;
      setLifted(next);
    });
  }, []);

  return (
    <header className={`lnv2-nav${lifted ? " is-lifted" : ""}`}>
      <div className="lnv2-nav-pill">
        <Link className="lnv2-nav-brand" to="/landing-v2">
          <BrandMarkV2 size={30} />
          <span className="lnv2-nav-word">이어봄</span>
          {/* 디자인 시스템의 내비 패턴 — 이름 옆의 작은 페리윙클 점. */}
          <span className="lnv2-nav-dot" aria-hidden="true" />
        </Link>

        <nav className="lnv2-nav-links" aria-label="랜딩 페이지 목차">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href}>
              {section.label}
            </a>
          ))}
        </nav>

        <div className="lnv2-nav-actions">
          <Link className="lnv2-nav-signin" to="/">
            로그인
          </Link>
          <Link className="lnv2-btn lnv2-btn-primary lnv2-btn-sm" to="/signup">
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
