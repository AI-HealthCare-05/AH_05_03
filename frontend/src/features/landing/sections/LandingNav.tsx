/**
 * 랜딩 내비게이션. **항목을 늘리지 않는다.**
 *
 * 앱의 주 메뉴(`RootLayout`)와 다른 물건이다 — 저쪽은 로그인한 사람이 화면 사이를
 * 오가는 문이고, 이쪽은 아직 아무것도 모르는 사람에게 세 곳만 가리킨다.
 * 스크롤이 시작되면 배경이 생겨 글자가 어떤 장면 위에서도 읽힌다.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { subscribeScroll } from "../scrollProgress";

const SECTIONS = [
  { href: "#service", label: "서비스" },
  { href: "#challenge", label: "건강 챌린지" },
  { href: "#family", label: "가족 건강" },
] as const;

export function LandingNav() {
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
    <header className={`ln-nav${lifted ? " is-lifted" : ""}`}>
      <div className="ln-nav-inner">
        <Link className="ln-nav-brand" to="/landing">
          <img src="/ieobom-icon.png" alt="" width={32} height={32} aria-hidden="true" />
          <span>이어봄</span>
        </Link>

        <nav className="ln-nav-links" aria-label="랜딩 페이지 목차">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href}>
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ln-nav-actions">
          <Link className="ln-nav-signin" to="/signin">
            로그인
          </Link>
          <Link className="ln-button ln-button-primary ln-button-sm" to="/signup">
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
