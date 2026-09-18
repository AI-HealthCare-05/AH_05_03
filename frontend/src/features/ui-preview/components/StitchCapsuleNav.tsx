import type { Ref } from "react";
import { NavLink } from "react-router-dom";

import { prefetchRouteFor } from "../../../app/prefetchRoutes";

/** 시안 네 화면이 같은 문을 쓴다. 순서는 첨부 캡슐 바와 같다. */
export const STITCH_PRIMARY_NAV = [
  { to: "/", label: "가족 홈", end: true },
  { to: "/pain-diary", label: "통증 다이어리", end: false },
  { to: "/assessment", label: "위험 판정 / 리포트", end: false },
  { to: "/health-data3", label: "건강 데이터 3", end: false },
] as const;

interface StitchCapsuleNavProps {
  ariaLabel?: string;
  className?: string;
  id?: string;
  navRef?: Ref<HTMLElement>;
}

export function StitchCapsuleNav({
  ariaLabel = "주 메뉴",
  className = "stitch-capsule-nav",
  id,
  navRef,
}: StitchCapsuleNavProps) {
  return (
    <nav id={id} className={className} aria-label={ariaLabel} ref={navRef}>
      {STITCH_PRIMARY_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
          onMouseEnter={() => prefetchRouteFor(item.to)}
          onFocus={() => prefetchRouteFor(item.to)}
          onTouchStart={() => prefetchRouteFor(item.to)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
